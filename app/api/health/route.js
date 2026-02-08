import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        version: '1.0.0',
        platform: 'ClawdPump',
        chain: 'solana',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
}
