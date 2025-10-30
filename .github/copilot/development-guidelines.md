# Development Guidelines

## Core Principles

### Performance First
- Prioritize performance and elegance in all code implementations
- Choose efficient algorithms and data structures
- Avoid unnecessary computations and memory allocations
- Leverage native APIs when possible to minimize dependencies
- Profile and optimize critical paths

### Code Quality
- Write clean, readable, and maintainable code
- Follow consistent naming conventions and code style
- Keep functions focused and single-purpose
- Prefer composition over inheritance
- Use TypeScript strict mode for type safety

## Documentation Standards

### Comment Strategy
Comments should be **selective and meaningful**, not exhaustive:

- ✅ **Public APIs** - All exported functions, classes, and types
- ✅ **Important Methods** - Complex logic or non-obvious implementations
- ✅ **Critical Logic** - Business rules, edge cases, or performance considerations
- ❌ Self-explanatory code - Let the code speak for itself
- ❌ Redundant descriptions - Avoid stating the obvious

### Comment Style
- Use concise English for all comments
- Keep JSDoc comments brief and to the point
- Focus on "why" rather than "what" when the code is clear
- Update comments when code changes

**Example:**
```typescript
// ✅ Good
/** Download and extract FRP binary for the current platform */
async function downloadFrpBinary(): Promise<void> {
  // implementation
}

// ❌ Bad (over-commenting)
// This function sets the value of x
const x = 5
```

## Architecture Guidelines

### Modularity
- Maintain clear separation of concerns across packages
- Keep package boundaries well-defined
- Use workspace dependencies (`workspace:*`) for internal packages
- Export only necessary APIs from each package

### Type Safety
- Leverage TypeScript's type system fully
- Define comprehensive types in `@frp-bridge/types`
- Avoid `any` type - use `unknown` when type is truly unknown
- Use generics for reusable components

### Error Handling
- Fail fast with clear error messages
- Use typed errors when appropriate
- Handle edge cases explicitly
- Validate inputs at boundaries

## Testing & Quality Assurance

### Pre-commit Checks
- Run `pnpm lint` to ensure code style compliance
- Run `pnpm build` to verify compilation
- Ensure TypeScript types are correct with `tsc --noEmit`

### Code Review Standards
- Keep PRs focused and reasonably sized
- Include rationale for significant changes
- Update documentation when changing public APIs

## Dependency Management

### Minimal Dependencies
- Evaluate necessity before adding new dependencies
- Prefer native Node.js APIs over third-party libraries
- Keep bundle size small for better performance
- Audit dependencies regularly for security and maintenance

### Version Control
- Use specific version ranges in package.json
- Document breaking changes in CHANGELOG
- Follow semantic versioning strictly

## Performance Best Practices

### Async Operations
- Use `async/await` for better readability
- Avoid blocking operations in critical paths
- Handle promises properly to prevent memory leaks
- Use streaming for large file operations

### Resource Management
- Clean up resources (processes, file handles, etc.)
- Implement graceful shutdown mechanisms
- Cache expensive computations when appropriate
- Be mindful of memory usage in long-running processes

## Naming Conventions

### Consistency
- Use descriptive, self-documenting names
- Follow established patterns within the codebase
- Keep names concise but clear
- Use TypeScript naming conventions (PascalCase for types, camelCase for variables/functions)

### Package Naming
- `@frp-bridge/*` - Scoped packages for internal modules
- `frp-bridge` - Main aggregated package
- `frpx` - CLI tool with memorable, short name

## Git Workflow

### Commit Messages
- Write clear, concise commit messages
- Use conventional commit format when applicable
- Reference issues/PRs when relevant

### Branch Strategy
- `main` - Stable, production-ready code
- Feature branches - Short-lived, focused changes
- Keep commits atomic and logical

---

**Remember**: Good code is code that is easy to understand, maintain, and perform well. When in doubt, optimize for clarity and performance.
