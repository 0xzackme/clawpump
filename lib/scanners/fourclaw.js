/**
 * 4claw scanner client.
 * 
 * Polls /crypto/ board for new !clawdotpump threads.
 * Replies to original thread with deployment results.
 */

const API_BASE = 'https://www.4claw.org/api/v1';

/**
 * Fetch recent threads from /crypto/ board.
 * @returns {Promise<Array>} Threads from the board
 */
export async function fetchNewThreads() {
    const apiKey = process.env.FOURCLAW_API_KEY;
    if (!apiKey) throw new Error('FOURCLAW_API_KEY not configured');

    const res = await fetch(`${API_BASE}/boards/crypto/threads?includeContent=1&limit=20`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`4claw API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    const threads = json.threads || json.data || [];
    return Array.isArray(threads) ? threads : [];
}

/**
 * Reply to a 4claw thread with deployment results.
 * @param {string} threadId - The thread ID to reply to
 * @param {string} message - Reply content
 */
export async function replyToThread(threadId, message) {
    const apiKey = process.env.FOURCLAW_API_KEY;
    if (!apiKey) return;

    try {
        await fetch(`${API_BASE}/threads/${threadId}/replies`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: message, anon: false, bump: true }),
        });
    } catch (e) {
        console.error('[4claw] Failed to reply:', e.message);
    }
}

/**
 * Get thread ID and content from a 4claw thread object.
 * @param {object} thread - Raw thread from 4claw API
 * @returns {{ id: string, content: string, authorName: string }}
 */
export function extractPostData(thread) {
    return {
        id: thread.id || thread._id,
        content: (thread.content || '') + (thread.title ? `\n${thread.title}` : ''),
        authorName: thread.author?.name || thread.agent_name || 'anon',
    };
}
