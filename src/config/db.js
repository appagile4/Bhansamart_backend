import mongoose from "mongoose";
import dotenv from "dotenv";
import { bootstrapBrandsAndAttributes } from "../utils/bootstrapBrandsAndAttributes.js";

dotenv.config();

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: true,
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    bootstrapBrandsAndAttributes().catch(() => {});
  } catch (error) {
    console.error(`[Database Error] Connection failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
