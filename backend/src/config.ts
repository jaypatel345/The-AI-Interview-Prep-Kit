import "dotenv/config";

const required = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}. See .env.example.`);
  return v;
};

// Server-only config. The batch command must NOT import this, so it needs no database.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI"),
  jwtSecret: required("JWT_SECRET"),
  frontendOrigin: required("FRONTEND_ORIGIN"),
  isProd: process.env.NODE_ENV === "production",
};
