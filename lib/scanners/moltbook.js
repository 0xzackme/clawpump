/**
 * Moltbook scanner client.
 * 
 * Polls m/clawdotpump submolt for new !clawdotpump posts.
 * Replies to original post with deployment results.
 */

const API_BASE = 'https://www.moltbook.com/api/v1';

/**
 * Fetch recent posts from m/clawdotpump submolt.
 * @returns {Promise<Array>} Posts from the submolt
 */
export async function fetchNewPosts() {
    const apiKey = process.env.MOLTBOOK_API_KEY;
    if (!apiKey) throw new Error('MOLTBOOK_API_KEY not configured');

    const res = await fetch(`${API_BASE}/submolts/clawdotpump/feed?sort=new&limit=50`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Moltbook API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    // Moltbook returns { success, data/posts }
    const posts = json.data || json.posts || [];
    return Array.isArray(posts) ? posts : [];
}

/**
 * Reply to a Moltbook post with deployment results.
 * @param {string} postId - The post ID to reply to
 * @param {string} message - Reply content
 */
export async function replyToPost(postId, message) {
    const apiKey = process.env.MOLTBOOK_API_KEY;
    if (!apiKey) return;

    try {
        await fetch(`${API_BASE}/posts/${postId}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: message }),
        });
    } catch (e) {
        console.error('[moltbook] Failed to reply:', e.message);
    }
}

/**
 * Get post ID and content from a Moltbook post object.
 * @param {object} post - Raw post from Moltbook API
 * @returns {{ id: string, content: string, authorName: string }}
 */
export function extractPostData(post) {
    return {
        id: post.id || post._id,
        content: (post.content || '') + (post.title ? `\n${post.title}` : ''),
        authorName: post.author?.name || post.agent_name || 'unknown',
    };
}
