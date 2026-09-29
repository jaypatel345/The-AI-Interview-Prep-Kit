import bcrypt from "bcryptjs";
import { NextFunction, Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "./config";
import { asyncHandler, HttpError } from "./http";
import { User } from "./models";

declare global { namespace Express { interface Request { userId?: string } } }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const cookieOpts = {
  httpOnly: true,                                   // not readable from page JavaScript
  secure: config.isProd,
  sameSite: (config.isProd ? "none" : "lax") as "none" | "lax",  // "none" is needed for a separately hosted frontend
  maxAge: WEEK_MS,
};
const creds = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200) });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) return next(new HttpError(401, "UNAUTHENTICATED", "Log in to continue."));
  try {
    req.userId = (jwt.verify(token, config.jwtSecret) as { sub: string }).sub;
    next();
  } catch {
    next(new HttpError(401, "SESSION_EXPIRED", "Your session has expired. Log in again."));
  }
}

export const authRouter = Router();
authRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false }));

const startSession = (res: Response, userId: string) =>
  res.cookie("session", jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" }), cookieOpts);

authRouter.post("/register", asyncHandler(async (req, res) => {
  const { email, password } = creds.parse(req.body);
  if (await User.exists({ email })) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
  startSession(res, user.id);
  res.status(201).json({ ok: true });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = creds.parse(req.body);
  const user = await User.findOne({ email: email.toLowerCase() });
  // Same message for unknown email and wrong password, so accounts cannot be enumerated.
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new HttpError(401, "BAD_CREDENTIALS", "Incorrect email or password.");
  startSession(res, user.id);
  res.json({ ok: true });
}));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("session", { ...cookieOpts, maxAge: undefined });
  res.json({ ok: true });
});
