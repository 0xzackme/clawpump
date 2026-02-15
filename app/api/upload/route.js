import { NextResponse } from 'next/server';

/**
 * POST /api/upload — Upload an image and get a direct URL
 *
 * Rate limited: 20 uploads per hour per IP.
 * Accepts:
 *   - JSON body: { image: "base64_data" } or { image: "https://..." }
 *   - Multipart form-data: file field named "image"
 */

const FREEIMAGE_KEY = process.env.FREEIMAGE_KEY || '6d207e02198a847aa98d0a2a901485a5';

// Simple in-memory rate limiter (per IP, resets hourly)
const uploadRateMap = new Map();
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 3600_000; // 1 hour

function checkUploadLimit(ip) {
    const now = Date.now();
    const entry = uploadRateMap.get(ip);
    if (!entry || now - entry.start > UPLOAD_WINDOW_MS) {
        uploadRateMap.set(ip, { start: now, count: 1 });
        return true;
    }
    if (entry.count >= UPLOAD_LIMIT) return false;
    entry.count++;
    return true;
}

// Cleanup old entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of uploadRateMap) {
        if (now - entry.start > UPLOAD_WINDOW_MS) uploadRateMap.delete(ip);
    }
}, 600_000);

export async function POST(request) {
    try {
        // Rate limit by IP
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || request.headers.get('x-real-ip')
            || 'unknown';

        if (!checkUploadLimit(ip)) {
            return NextResponse.json({
                success: false,
                error: `Rate limit: max ${UPLOAD_LIMIT} uploads per hour`,
            }, { status: 429 });
        }

        let base64Data;
        let fileName = 'upload';

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            // Handle multipart/form-data file upload
            const formData = await request.formData();
            const file = formData.get('image');
            fileName = formData.get('name') || 'upload';

            if (!file || !(file instanceof File)) {
                return NextResponse.json({
                    success: false,
                    error: 'Missing "image" file field in multipart form data.',
                }, { status: 400 });
            }

            // Validate content type
            if (!file.type.startsWith('image/')) {
                return NextResponse.json({
                    success: false,
                    error: 'File must be an image (image/png, image/jpeg, etc.)',
                }, { status: 400 });
            }

            // Validate size (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                return NextResponse.json({
                    success: false,
                    error: 'Image too large. Max 10MB.',
                }, { status: 400 });
            }

            const arrayBuffer = await file.arrayBuffer();
            base64Data = Buffer.from(arrayBuffer).toString('base64');
        } else {
            // Handle JSON body
            const body = await request.json();
            const { image, name } = body;
            if (name) fileName = name;

            if (!image) {
                return NextResponse.json({
                    success: false,
                    error: 'Missing "image" field. Provide base64 data, an image URL, or upload via multipart/form-data.',
                }, { status: 400 });
            }

            // Validate size (max 10MB base64)
            if (typeof image === 'string' && image.length > 10 * 1024 * 1024) {
                return NextResponse.json({
                    success: false,
                    error: 'Image too large. Max 10MB.',
                }, { status: 400 });
            }

            if (image.startsWith('http://') || image.startsWith('https://')) {
                // Block internal/private URLs (SSRF protection)
                try {
                    const url = new URL(image);
                    const host = url.hostname.toLowerCase();
                    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local') || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) {
                        return NextResponse.json({ success: false, error: 'Internal URLs not allowed' }, { status: 400 });
                    }
                } catch {
                    return NextResponse.json({ success: false, error: 'Invalid image URL' }, { status: 400 });
                }

                try {
                    const imgRes = await fetch(image, { signal: AbortSignal.timeout(10000) });
                    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);

                    const imgContentType = imgRes.headers.get('content-type') || '';
                    if (!imgContentType.startsWith('image/')) {
                        return NextResponse.json({ success: false, error: 'URL must point to an image' }, { status: 400 });
                    }

                    const buffer = await imgRes.arrayBuffer();
                    if (buffer.byteLength > 10 * 1024 * 1024) {
                        return NextResponse.json({ success: false, error: 'Image too large. Max 10MB.' }, { status: 400 });
                    }
                    base64Data = Buffer.from(buffer).toString('base64');
                } catch (e) {
                    return NextResponse.json({
                        success: false,
                        error: `Failed to download image: ${e.message}`,
                    }, { status: 400 });
                }
            } else {
                base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
            }
        }

        const formData = new URLSearchParams();
        formData.append('source', base64Data);
        formData.append('type', 'base64');
        formData.append('action', 'upload');
        if (fileName) formData.append('title', fileName);

        const uploadRes = await fetch(`https://freeimage.host/api/1/upload?key=${FREEIMAGE_KEY}`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(15000),
        });

        if (!uploadRes.ok) {
            const text = await uploadRes.text();
            throw new Error(`Upload service error: ${uploadRes.status} ${text}`);
        }

        const uploadJson = await uploadRes.json();

        if (uploadJson.status_code !== 200 || !uploadJson.image?.url) {
            throw new Error(uploadJson.error?.message || 'Upload failed');
        }

        return NextResponse.json({
            success: true,
            url: uploadJson.image.url,
        });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error',
        }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        message: 'Image upload endpoint',
        usage: {
            base64: 'POST with { "image": "base64_data", "name": "logo" }',
            url: 'POST with { "image": "https://example.com/image.png" }',
            multipart: 'POST with multipart/form-data, field name "image" (file) + optional "name"',
        },
        limits: `${UPLOAD_LIMIT} uploads per hour per IP, max 10MB`,
    });
}
