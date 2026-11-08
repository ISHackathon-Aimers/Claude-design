import webpush from 'web-push';
import { randomBytes } from 'node:crypto';
const keys = webpush.generateVAPIDKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nCRON_SECRET=${randomBytes(32).toString('hex')}\n`);
