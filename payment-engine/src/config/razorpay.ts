import { env } from './env';

const Razorpay = require('razorpay');

const razorpayInstance = new Razorpay({
  key_id:     env.RAZORPAY_KEY_ID     ?? '',
  key_secret: env.RAZORPAY_KEY_SECRET ?? '',
});

export default razorpayInstance;