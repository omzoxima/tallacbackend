import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || '';
const BUCKET_REGION = process.env.AWS_REGION || 'us-east-1';

// Generate unique file name
export function generateFileName(originalName: string): string {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = originalName.split('.').pop();
  return `knowledge-base/${timestamp}-${randomString}.${extension}`;
}

// Upload file to S3
export async function uploadFileToS3(
  file: Express.Multer.File,
  fileName: string
): Promise<string> {
  try {
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Note: ACL is removed as modern S3 buckets use bucket policies instead
      // Make sure your bucket has a bucket policy that allows public read access
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // Return public URL
    const publicUrl = `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${fileName}`;
    return publicUrl;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw new Error('Failed to upload file to S3');
  }
}

// Delete file from S3
export async function deleteFileFromS3(filePath: string): Promise<void> {
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

    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    throw new Error('Failed to delete file from S3');
  }
}

// Get signed URL for private files (if needed in future)
export async function getSignedUrlForFile(filePath: string, expiresIn: number = 3600): Promise<string> {
  try {
    let key = filePath;
    if (filePath.includes('.amazonaws.com/')) {
      key = filePath.split('.amazonaws.com/')[1];
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL');
  }
}

// Get public URL for a file
export function getPublicUrl(fileName: string): string {
  return `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${fileName}`;
}

