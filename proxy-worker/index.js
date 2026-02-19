export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Rewrite the URL to point to Coinbase
        // Example: https://proxy.workers.dev/v2/accounts -> https://api.coinbase.com/v2/accounts
        const targetUrl = `https://api.coinbase.com${url.pathname}${url.search}`;

        // Create a new request with the original method, headers, and body
        // We clone the headers because some might be read-only
        const newHeaders = new Headers(request.headers);

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : undefined,
            redirect: 'follow'
        });

        // Fetch from Coinbase
        let response = await fetch(proxyRequest);

        // Reconstruct the response to add CORS headers
        response = new Response(response.body, response);
        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

        // Handle Preflight (OPTIONS) requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                }
            });
        }

        return response;
    },
};
