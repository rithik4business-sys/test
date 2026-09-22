# Contributing to TypeWriter

Thank you for your interest in contributing to TypeWriter! This document provides guidelines and information for contributors.

## How to Contribute

### 1. Fork the Repository

```bash
# Fork on GitHub, then clone
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Add upstream remote
git remote add upstream https://github.com/originalusername/typewriter.git
```

### 2. Set Up Development Environment

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev
```

### 3. Create a Branch

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Or a bug fix branch
git checkout -b fix/your-bug-fix
```

### 4. Make Your Changes

- Follow the existing code style
- Write clear, concise commit messages
- Add tests if applicable
- Update documentation if needed

### 5. Test Your Changes

```bash
# Build the project
npm run build

# Test manually
node dist/index.js --help
node dist/index.js your-test-file.ts
```

### 6. Commit Your Changes

```bash
# Stage changes
git add .

# Commit with a descriptive message
git commit -m "feat: add new feature description"

# Or for bug fixes
git commit -m "fix: describe the bug fix"
```

### 7. Push and Create Pull Request

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create a pull request on GitHub
```

## Code Style Guidelines

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use meaningful variable names
- Add type annotations where helpful
- Keep functions small and focused

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `syntax-highlight.ts`)
- **Variables**: `camelCase` (e.g., `editorState`)
- **Functions**: `camelCase` (e.g., `handleKeyPress`)
- **Classes**: `PascalCase` (e.g., `Editor`)
- **Interfaces**: `PascalCase` (e.g., `EditorState`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_LINE_LENGTH`)

### Comments

- Use JSDoc for public APIs
- Add comments for complex logic
- Keep comments up to date
- Don't comment obvious code

## Commit Message Format

Follow the Conventional Commits specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Examples

```
feat(editor): add syntax highlighting for Python

fix(github): handle authentication timeout

docs(readme): update installation instructions

refactor(highlight): simplify token parsing logic
```

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

1. **Environment**: OS, Node.js version, terminal emulator
2. **Steps to Reproduce**: Clear steps to reproduce the issue
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Screenshots**: If applicable

### Feature Requests

When requesting features, please include:

1. **Use Case**: Why you need this feature
2. **Proposed Solution**: How you think it should work
3. **Alternatives**: Other solutions you've considered

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Avoid personal attacks and harassment
- Help create a positive community

## Questions?

If you have questions about contributing, feel free to:

1. Open an issue with the "question" label
2. Reach out to maintainers
3. Join our community discussions

Thank you for contributing to TypeWriter!
