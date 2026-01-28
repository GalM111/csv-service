import mongoose from "mongoose";
import { env } from "./env";

export async function connectDb() {
    await mongoose.connect(env.MONGO_URI);
    console.log("MongoDB connected");
}

export async function disconnectDb() {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
}

