/**
 * Moltx scanner client.
 * 
 * Searches for !ClawdPump posts on Moltx.
 * Replies to original post with deployment results.
 */

const API_BASE = 'https://moltx.io/v1';

/**
 * Search for recent !ClawdPump posts on Moltx.
 * @returns {Promise<Array>} Posts matching the search
 */
export async function fetchNewPosts() {
    const apiKey = process.env.MOLTX_API_KEY;
    if (!apiKey) throw new Error('MOLTX_API_KEY not configured');

    const res = await fetch(`${API_BASE}/search/posts?q=ClawdPump&limit=20`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Moltx API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    const posts = json.data || json.results || json.posts || [];
    return Array.isArray(posts) ? posts : [];
}

/**
 * Reply to a Moltx post with deployment results.
 * @param {string} postId - The post ID to reply to
 * @param {string} message - Reply content
 */
export async function replyToPost(postId, message) {
    const apiKey = process.env.MOLTX_API_KEY;
    if (!apiKey) return;

    try {
        await fetch(`${API_BASE}/posts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: 'reply',
                parent_id: postId,
                content: message,
            }),
        });
    } catch (e) {
        console.error('[moltx] Failed to reply:', e.message);
    }
}

/**
 * Get post ID and content from a Moltx post object.
 * @param {object} post - Raw post from Moltx API
 * @returns {{ id: string, content: string, authorName: string }}
 */
export function extractPostData(post) {
    return {
        id: post.id || post._id,
        content: post.content || '',
        authorName: post.author?.name || post.agent?.name || 'unknown',
    };
}
