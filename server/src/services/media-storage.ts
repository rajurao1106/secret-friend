import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';

export interface MediaUploadInstructions {
  readonly uploadUrl: string;
  readonly method: 'POST';
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresInSeconds: number;
}

export interface MediaStorage {
  readonly configured: boolean;
  keyForUpload(
    ownerId: string,
    kind: 'gallery' | 'chat' | 'profile',
    id: string,
    mime: string,
  ): string;
  presignUpload(
    key: string,
    expiresInSeconds: number,
  ): Promise<MediaUploadInstructions>;
  presignDownload(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<{ readonly size: number; readonly mime: string }>;
  delete(key: string): Promise<void>;
}

const cloudinaryResourceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  format: z.string().min(1),
});
const cloudinaryDestroySchema = z.object({
  result: z.enum(['ok', 'not found']),
});

const mimeByFormat: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};
const extensionByMime: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
};

type CloudinaryResourceType = 'image' | 'raw';

function parseKey(key: string): {
  readonly resourceType: CloudinaryResourceType;
  readonly publicId: string;
} {
  const match = /^(image|raw)\/(.+)$/.exec(key);
  if (match === null || match[2] === undefined) {
    throw new Error('Invalid Cloudinary media key');
  }
  return {
    resourceType: match[1] === 'image' ? 'image' : 'raw',
    publicId: match[2],
  };
}

export class CloudinaryMediaStorage implements MediaStorage {
  readonly configured = true;
  readonly #cloudName: string;
  readonly #apiKey: string;
  readonly #apiSecret: string;

  constructor(config: AppConfig) {
    if (
      config.CLOUDINARY_CLOUD_NAME === undefined ||
      config.CLOUDINARY_API_KEY === undefined ||
      config.CLOUDINARY_API_SECRET === undefined
    ) {
      throw new Error('Cloudinary storage configuration is incomplete');
    }

    this.#cloudName = config.CLOUDINARY_CLOUD_NAME;
    this.#apiKey = config.CLOUDINARY_API_KEY;
    this.#apiSecret = config.CLOUDINARY_API_SECRET;
    cloudinary.config({
      cloud_name: this.#cloudName,
      api_key: this.#apiKey,
      api_secret: this.#apiSecret,
      secure: true,
    });
  }

  keyForUpload(
    ownerId: string,
    kind: 'gallery' | 'chat' | 'profile',
    id: string,
    mime: string,
  ): string {
    const resourceType = mime.startsWith('image/') ? 'image' : 'raw';
    const extension = extensionByMime[mime];
    const publicId = `${ownerId}/${kind}/${id}${
      resourceType === 'raw' && extension !== undefined ? `.${extension}` : ''
    }`;
    return `${resourceType}/${publicId}`;
  }

  async presignUpload(
    key: string,
    expiresInSeconds: number,
  ): Promise<MediaUploadInstructions> {
    const { resourceType, publicId } = parseKey(key);
    const timestamp = Math.floor(Date.now() / 1000);
    const signedFields = {
      overwrite: 'false',
      public_id: publicId,
      timestamp: String(timestamp),
      type: 'authenticated',
    };
    const signature = cloudinary.utils.api_sign_request(
      signedFields,
      this.#apiSecret,
    );
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.#cloudName}/${resourceType}/upload`,
      method: 'POST',
      fields: {
        ...signedFields,
        api_key: this.#apiKey,
        signature,
      },
      expiresInSeconds,
    };
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    const { resourceType, publicId } = parseKey(key);
    const resource = await this.#getResource(publicId, resourceType);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return cloudinary.utils.private_download_url(publicId, resource.format, {
      resource_type: resourceType,
      type: 'authenticated',
      expires_at: expiresAt,
    });
  }

  async head(key: string): Promise<{ readonly size: number; readonly mime: string }> {
    const { resourceType, publicId } = parseKey(key);
    const resource = await this.#getResource(publicId, resourceType);
    const mime = mimeByFormat[resource.format.toLowerCase()];
    if (mime === undefined) {
      throw new Error(`Cloudinary returned unsupported media format: ${resource.format}`);
    }
    return { size: resource.bytes, mime };
  }

  async delete(key: string): Promise<void> {
    const { resourceType, publicId } = parseKey(key);
    const result: unknown = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      invalidate: true,
    });
    cloudinaryDestroySchema.parse(result);
  }

  async #getResource(
    publicId: string,
    resourceType: CloudinaryResourceType,
  ): Promise<z.infer<typeof cloudinaryResourceSchema>> {
    const result: unknown = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
    });
    return cloudinaryResourceSchema.parse(result);
  }
}

export class UnavailableMediaStorage implements MediaStorage {
  readonly configured = false;

  keyForUpload(): string {
    throw new Error('Cloudinary storage is not configured');
  }

  async presignUpload(): Promise<MediaUploadInstructions> {
    throw new Error('Cloudinary storage is not configured');
  }

  async presignDownload(): Promise<string> {
    throw new Error('Cloudinary storage is not configured');
  }

  async head(): Promise<{ readonly size: number; readonly mime: string }> {
    throw new Error('Cloudinary storage is not configured');
  }

  async delete(): Promise<void> {
    throw new Error('Cloudinary storage is not configured');
  }
}

export function createMediaStorage(config: AppConfig): MediaStorage {
  const configured = [
    config.CLOUDINARY_CLOUD_NAME,
    config.CLOUDINARY_API_KEY,
    config.CLOUDINARY_API_SECRET,
  ].every((value) => value !== undefined);
  return configured
    ? new CloudinaryMediaStorage(config)
    : new UnavailableMediaStorage();
}
