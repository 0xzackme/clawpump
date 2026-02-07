import { NextResponse } from 'next/server';

/**
 * POST /api/upload — Upload an image and get a direct URL
 * 
 * Accepts:
 *   { "image": "base64_encoded_data", "name": "my-token-logo" }
 *   { "image": "https://example.com/image.png" }
 * 
 * Re-hosts via freeimage.host and returns a direct URL.
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { image, name } = body;

        if (!image) {
            return NextResponse.json({
                success: false,
                error: 'Missing "image" field. Provide base64 data or an image URL.',
            }, { status: 400 });
        }

        let base64Data;

        if (image.startsWith('http://') || image.startsWith('https://')) {
            // Fetch the image and convert to base64
            try {
                const imgRes = await fetch(image);
                if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
                const buffer = await imgRes.arrayBuffer();
                base64Data = Buffer.from(buffer).toString('base64');
            } catch (e) {
                return NextResponse.json({
                    success: false,
                    error: `Failed to download image: ${e.message}`,
                }, { status: 400 });
            }
        } else {
            // Assume base64 — strip data URI prefix if present
            base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
        }

        // Upload to freeimage.host (free API, no key required)
        const formData = new URLSearchParams();
        formData.append('source', base64Data);
        formData.append('type', 'base64');
        formData.append('action', 'upload');
        if (name) formData.append('title', name);

        const uploadRes = await fetch('https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', {
            method: 'POST',
            body: formData,
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
            hint: 'Use the "url" value in your !clawdotpump post as the "image" field',
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
        },
        response: {
            success: true,
            url: 'https://iili.io/xxxxx.jpg',
        },
    });
}
