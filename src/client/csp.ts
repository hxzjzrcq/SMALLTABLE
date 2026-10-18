import { z } from 'zod';
// The room UI runs under script-src self. Use Zod's interpreter so its
// optional JIT capability probe never attempts eval in the browser.
z.config({ jitless: true });
