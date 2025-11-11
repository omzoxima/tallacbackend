"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFileName = generateFileName;
exports.uploadFileToS3 = uploadFileToS3;
exports.deleteFileFromS3 = deleteFileFromS3;
exports.getSignedUrlForFile = getSignedUrlForFile;
exports.getPublicUrl = getPublicUrl;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = __importDefault(require("crypto"));
// Initialize S3 client
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || '';
const BUCKET_REGION = process.env.AWS_REGION || 'us-east-1';
// Generate unique file name
function generateFileName(originalName) {
    const timestamp = Date.now();
    const randomString = crypto_1.default.randomBytes(16).toString('hex');
    const extension = originalName.split('.').pop();
    return `knowledge-base/${timestamp}-${randomString}.${extension}`;
}
// Upload file to S3
async function uploadFileToS3(file, fileName) {
    try {
        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            // Note: ACL is removed as modern S3 buckets use bucket policies instead
            // Make sure your bucket has a bucket policy that allows public read access
        };
        const command = new client_s3_1.PutObjectCommand(uploadParams);
        await s3Client.send(command);
        // Return public URL
        const publicUrl = `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${fileName}`;
        return publicUrl;
    }
    catch (error) {
        console.error('Error uploading file to S3:', error);
        throw new Error('Failed to upload file to S3');
    }
}
// Delete file from S3
async function deleteFileFromS3(filePath) {
    try {
        // Extract key from URL or use as-is if it's already a key
        let key = filePath;
        if (filePath.includes('.amazonaws.com/')) {
            key = filePath.split('.amazonaws.com/')[1];
        }
        const deleteParams = {
            Bucket: BUCKET_NAME,
            Key: key,
        };
        const command = new client_s3_1.DeleteObjectCommand(deleteParams);
        await s3Client.send(command);
    }
    catch (error) {
        console.error('Error deleting file from S3:', error);
        throw new Error('Failed to delete file from S3');
    }
}
// Get signed URL for private files (if needed in future)
async function getSignedUrlForFile(filePath, expiresIn = 3600) {
    try {
        let key = filePath;
        if (filePath.includes('.amazonaws.com/')) {
            key = filePath.split('.amazonaws.com/')[1];
        }
        const command = new client_s3_1.GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });
        const url = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn });
        return url;
    }
    catch (error) {
        console.error('Error generating signed URL:', error);
        throw new Error('Failed to generate signed URL');
    }
}
// Get public URL for a file
function getPublicUrl(fileName) {
    return `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${fileName}`;
}
//# sourceMappingURL=s3Service.js.map