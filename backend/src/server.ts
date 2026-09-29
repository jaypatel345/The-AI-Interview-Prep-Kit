import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { authRouter, requireAuth } from "./auth";
import { config } from "./config";
import { errorHandler, HttpError } from "./http";
import { recoverOrphans } from "./jobs";
import { kitsRouter } from "./kits";

const app = express();
app.set("trust proxy", 1);                          // behind a host's proxy, so rate limits see real client IPs
app.use(helmet());
app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());

// CSRF defence for cookie auth: state-changing requests must come from our frontend and be JSON.
// Browsers cannot send cross-site JSON without a CORS preflight, which the cors() allow-list rejects.
app.use((req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers.origin && req.headers.origin !== config.frontendOrigin) return next(new HttpError(403, "BAD_ORIGIN", "Request origin not allowed."));
  if (!req.is("application/json")) return next(new HttpError(415, "JSON_REQUIRED", "Send application/json."));
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/kits", requireAuth, kitsRouter);      // every kit route sits behind the session check
app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Not found.")));
app.use(errorHandler);

mongoose.connect(config.mongoUri).then(async () => {
  await recoverOrphans();
  app.listen(config.port, () => console.log(`API listening on :${config.port}`));
}).catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
