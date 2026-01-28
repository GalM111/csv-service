import dotenv from "dotenv";
dotenv.config();

export const env = {
    PORT: Number(process.env.PORT || 4000),
    MONGO_URI: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/csv_import",
};
