/**
 * The browser only ever talks to this Next.js origin; /api/* is proxied to the Express API.
 * That keeps the session cookie first-party, so browsers that block third-party cookies (Safari) still work.
 */
const API_URL = process.env.API_URL || "http://localhost:4000";
export default {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};
