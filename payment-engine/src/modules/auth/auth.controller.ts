import { Router, Response, NextFunction } from 'express';
import { Request } from 'express';
import * as authService from './auth.service';
import { authenticate } from '../../middleware/auth.middleware';
import { authRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate, asyncHandler } from '../../utils/validate';
import { registerSchema, loginSchema } from './auth.validation';
import { AuthenticatedRequest } from '../../types';

const router = Router();

router.post(
  '/register',
  authRateLimiter,
  validate(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.registerUser(req.body);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: result,
    });
  }),
);

router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.loginUser(req.body);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;

    const tokenExp = authReq.user.exp ?? Math.floor(Date.now() / 1000) + 3600;

    await authService.logoutUser(authReq.user.jti, tokenExp);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
      data: null,
    });
  }),
);

export default router;