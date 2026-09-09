import type { LoginInput, RegisterInput } from './types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(input: LoginInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = 'Enter a valid email address.';
  if (!input.password) errors.password = 'Enter your password.';
  return errors;
}

export function validateRegistration(
  input: RegisterInput & { confirmPassword: string },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.displayName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) errors.displayName = 'Use between 2 and 60 characters.';
  if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = 'Enter a valid email address.';
  if (input.password.length < 10) errors.password = 'Use at least 10 characters.';
  if (input.password !== input.confirmPassword) errors.confirm = 'Passwords do not match.';
  if (!input.termsAccepted) errors.terms = 'You must acknowledge the terms and privacy notice.';
  return errors;
}
