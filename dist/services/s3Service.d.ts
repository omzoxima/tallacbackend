export declare function generateFileName(originalName: string): string;
export declare function uploadFileToS3(file: Express.Multer.File, fileName: string): Promise<string>;
export declare function deleteFileFromS3(filePath: string): Promise<void>;
export declare function getSignedUrlForFile(filePath: string, expiresIn?: number): Promise<string>;
export declare function getPublicUrl(fileName: string): string;
//# sourceMappingURL=s3Service.d.ts.map