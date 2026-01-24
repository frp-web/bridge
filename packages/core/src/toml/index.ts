/**
 * Unified TOML parsing and serialization module
 * Wraps smol-toml with consistent error handling
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

export interface ParseOptions {
  /**
   * Parse integers as BigInt
   */
  integersAsBigInt?: boolean | 'asNeeded'
}

export interface StringifyOptions {
  /**
   * Serialize numbers as floats
   */
  numbersAsFloat?: boolean
}

/**
 * Parse TOML string to JavaScript object
 * @param content - TOML string content
 * @param options - Parse options
 * @returns Parsed JavaScript object
 * @throws {Error} If TOML is invalid
 */
export function parse<T = Record<string, any>>(
  content: string,
  options?: ParseOptions
): T {
  try {
    return parseToml(content, options) as T
  }
  catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`Failed to parse TOML: ${error.message}`)
    }
    throw new Error('Failed to parse TOML: Unknown error')
  }
}

/**
 * Serialize JavaScript object to TOML string
 * @param obj - JavaScript object to serialize
 * @param options - Stringify options
 * @returns TOML string
 * @throws {Error} If object contains unserializable values
 */
export function stringify(
  obj: Record<string, any>,
  options?: StringifyOptions
): string {
  try {
    return stringifyToml(obj, options)
  }
  catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`Failed to stringify to TOML: ${error.message}`)
    }
    throw new Error('Failed to stringify to TOML: Unknown error')
  }
}

/**
 * Check if a string is valid TOML
 * @param content - String content to check
 * @returns true if valid TOML, false otherwise
 */
export function isValidToml(content: string): boolean {
  try {
    parse(content)
    return true
  }
  catch {
    return false
  }
}

/**
 * Parse TOML file content safely (returns null on error)
 * @param content - TOML string content
 * @returns Parsed object or null if parsing fails
 */
export function safeParse<T = Record<string, any>>(
  content: string
): T | null {
  try {
    return parse<T>(content)
  }
  catch {
    return null
  }
}
