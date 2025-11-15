/**
 * List of field names that should be masked in logs
 * These are common sensitive field names across different entities
 */
export const SENSITIVE_FIELDS = [
  // Common sensitive fields
  'password',
  'token',
  'secret',
  'key',
  'api_key',
  'apiKey',
  'access_token',
  'refresh_token',
  'authorization',
  'auth',
  'credential',
  'private_key',
  'privateKey',
  
  // IDs that might be sensitive
  'device_id',
  'deviceId',
  'session_id',
  'sessionId',
  'campaign_session_id',
  'content_session_id',
  'audience_id',
  'advertiser_id',
  
  // Personal information
  'email',
  'phone',
  'ssn',
  'social_security',
  'credit_card',
  'card_number',
  'cardNumber',
  
  // Business sensitive
  'pricing_rule',
  'pricingRule',
] as const;

/**
 * Mask a value to hide sensitive information
 */
export function maskValue(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  const strValue = String(value);
  
  // If field name is in sensitive list, mask it
  if (fieldName && isSensitiveField(fieldName)) {
    if (strValue.length <= 4) {
      return '****';
    }
    // Show first 2 and last 2 characters, mask the rest
    const start = strValue.substring(0, 2);
    const end = strValue.substring(strValue.length - 2);
    return `${start}${'*'.repeat(Math.max(4, strValue.length - 4))}${end}`;
  }

  return strValue;
}

/**
 * Check if a field name is considered sensitive
 */
export function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some((field) => lowerName.includes(field.toLowerCase()));
}

/**
 * Mask sensitive fields in an object
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  depth = 0,
  maxDepth = 5
): Partial<T> {
  if (depth > maxDepth || !obj || typeof obj !== 'object') {
    return obj as Partial<T>;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? maskSensitiveFields(item as Record<string, unknown>, depth + 1, maxDepth)
        : item
    ) as unknown as Partial<T>;
  }

  const masked: Partial<T> = {} as Partial<T>;

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      masked[key as keyof T] = maskValue(value, key) as T[keyof T];
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      masked[key as keyof T] = maskSensitiveFields(
        value as Record<string, unknown>,
        depth + 1,
        maxDepth
      ) as T[keyof T];
    } else {
      masked[key as keyof T] = value as T[keyof T];
    }
  }

  return masked;
}

