# TypeWriter Installation Guide

## Quick Start

### Prerequisites
- **Node.js** v18.0.0 or higher
- **npm** (comes with Node.js)

### Installation Steps

#### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/typewriter.git
cd typewriter
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Build the Project
```bash
npm run build
```

#### 4. Test the Installation
```bash
# Show help
node dist/index.js --help

# Show version
node dist/index.js --version

# Open a file
node dist/index.js your-file.ts
```

#### 5. Link Globally (Optional)
```bash
npm link
```

Now you can use `typewriter` command globally.

## Windows Installation

### Using PowerShell
```powershell
# Clone repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install and build
npm install
npm run build

# Run with PowerShell wrapper
.\typewriter.ps1 --help
```

### Using Command Prompt
```cmd
# Clone repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install and build
npm install
npm run build

# Run with batch wrapper
typewriter.bat --help
```

## macOS/Linux Installation

```bash
# Clone repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install and build
npm install
npm run build

# Link globally
npm link

# Now use anywhere
typewriter --help
```

## GitHub Setup

### First Time Login
```bash
# Login to GitHub
typewriter --login

# Follow the device authorization flow:
# 1. Visit the URL shown in terminal
# 2. Enter the code displayed
# 3. Authorize TypeWriter in your browser
# 4. Wait for authentication to complete
```

### Push Projects
```bash
# Navigate to your project directory
cd my-project

# Push to GitHub
typewriter --push

# The tool will:
# 1. Create a new repository if needed
# 2. Add all project files
# 3. Push to GitHub
```

### Manage Authentication
```bash
# Check login status
typewriter --status

# Logout
typewriter --logout
```

## Verification

After installation, verify everything works:

```bash
# Check version
typewriter --version
# Output: typewriter v1.0.0

# Check help
typewriter --help
# Output: Shows usage information

# Check GitHub status
typewriter --status
# Output: Shows login status

# Open a test file
echo "Hello World" > test.txt
typewriter test.txt
# Output: Opens the editor with the file
```

## Troubleshooting

### Common Issues

#### "tsc: command not found"
```bash
# Install TypeScript globally
npm install -g typescript

# Or use npx
npx tsc
```

#### "Permission denied"
```bash
# Make scripts executable (macOS/Linux)
chmod +x typewriter.ps1
chmod +x typewriter.bat
```

#### "Node.js not found"
```bash
# Install Node.js from https://nodejs.org
# Or use nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 14
nvm use 14
```

#### "GitHub login fails"
```bash
# Check internet connection
ping github.com

# Try logging out and back in
typewriter --logout
typewriter --login
```

### Getting Help

If you encounter issues:

1. Check the [USAGE.md](docs/USAGE.md) documentation
2. Search existing GitHub Issues
3. Create a new issue with:
   - Your operating system
   - Node.js version (`node --version`)
   - Error message
   - Steps to reproduce

## Uninstallation

```bash
# Remove global link
npm unlink -g typewriter-editor

# Remove the directory
rm -rf typewriter

# Remove configuration
rm -rf ~/.typewriter
```

## Next Steps

After installation, check out:

- **[README.md](README.md)** - Project overview
- **[USAGE.md](docs/USAGE.md)** - Detailed usage guide
- **[CHANGELOG.md](CHANGELOG.md)** - Version history
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - How to contribute

---

**Need help?** Open an issue on GitHub!
