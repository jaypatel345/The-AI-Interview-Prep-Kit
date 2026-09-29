import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const asyncHandler = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

// Every error leaves the API as { error: { code, message } } so the UI can always show something useful.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return res.status(400).json({ error: { code: "VALIDATION", message: `${issue.path.join(".") || "request"}: ${issue.message}` } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Try again." } });
}
