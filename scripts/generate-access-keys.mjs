import { createHmac, randomBytes } from 'node:crypto';

const accessKey = randomBytes(24).toString('base64url');
const accessProof = createHmac('sha256', accessKey).update('duty-workbench:access:v1').digest('hex');
const sessionKey = randomBytes(32).toString('hex');

console.log(`访问密钥（用于登录）  ${accessKey}`);
console.log(`DUTY_ACCESS_PROOF    ${accessProof}`);
console.log(`DUTY_SESSION_KEY     ${sessionKey}`);
