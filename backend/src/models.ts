import mongoose, { Schema } from "mongoose";

export const User = mongoose.model("User", new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true }));

const kitSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  hash: { type: String, required: true },          // identifies "same posting, same company, same days"
  jd: { type: String, required: true },
  company_url: { type: String, required: true },
  days: { type: Number, required: true },
  status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
  progress: { step: { type: String, default: "" }, warnings: { type: [String], default: [] } },
  error: { code: String, message: String },
  kit: Schema.Types.Mixed,                          // validated against KitSchema before every write
  research: Schema.Types.Mixed,                     // cleaned page text etc., so one section can be regenerated without re-crawling
  practice: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });
// One kit per user per identical request: makes double-submits idempotent at the database level.
kitSchema.index({ userId: 1, hash: 1 }, { unique: true });

export const KitModel = mongoose.model("Kit", kitSchema);
