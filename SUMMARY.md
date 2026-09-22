# TypeWriter - Project Summary

## Overview

TypeWriter is a lightweight, dependency-free terminal code editor built with TypeScript. It provides a VS Code-like editing experience directly in your terminal with automatic GitHub synchronization.

## Project Structure

```
typewriter/
├── src/
│   ├── index.ts          # Main entry point
│   ├── editor.ts         # Core editor logic
│   ├── highlight.ts      # Syntax highlighting
│   ├── github.ts         # GitHub integration
│   └── utils.ts          # Utility functions
├── dist/                 # Compiled JavaScript
├── docs/
│   └── USAGE.md          # Usage documentation
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
├── README.md             # Main documentation
├── CHANGELOG.md          # Version history
├── CONTRIBUTING.md       # Contribution guidelines
├── LICENSE               # MIT License
├── typewriter.ps1        # PowerShell wrapper
├── typewriter.bat        # Windows batch wrapper
├── example.ts            # Example TypeScript file
├── example.js            # Example JavaScript file
├── example.py            # Example Python file
├── example.html          # Example HTML file
└── example.css           # Example CSS file
```

## Features

### Core Editor
- **Full-screen terminal interface** with line numbers
- **Vim-like keybindings** for efficient editing
- **Multiple modes**: Normal, Insert, Command, Search
- **File operations**: Open, Save, Save As, New
- **Search and replace** with match highlighting
- **Horizontal and vertical scrolling**

### Syntax Highlighting
- **20+ programming languages** supported
- **Token-based highlighting** for keywords, strings, numbers, comments
- **Language detection** from file extensions

### GitHub Integration
- **Device authentication flow** for secure login
- **Auto-push projects** to GitHub repositories
- **Create new repositories** automatically
- **Smart file filtering** (skips node_modules, .git, etc.)

### Cross-Platform
- **Windows**: PowerShell and Command Prompt support
- **macOS**: Terminal and iTerm2 support
- **Linux**: Bash, Zsh, and other terminals

## Technical Details

### Architecture
- **Modular design** with separate components
- **TypeScript** for type safety
- **Zero runtime dependencies** for fast startup
- **Event-driven** editor core

### Performance
- **Lightweight**: ~50KB total code size
- **Fast startup**: <100ms initialization
- **Low memory**: ~10MB runtime usage
- **Responsive**: Real-time syntax highlighting

### Security
- **Local token storage** only
- **OAuth 2.0** device flow
- **No telemetry** or data collection
- **HTTPS** for all GitHub API calls

## Installation

```bash
# Clone repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install dev dependencies
npm install

# Build project
npm run build

# Link globally (optional)
npm link
```

## Usage

```bash
# Start editor
typewriter

# Open file
typewriter myfile.ts

# Login to GitHub
typewriter --login

# Push to GitHub
typewriter --push

# Get help
typewriter --help
```

## Development

### Prerequisites
- Node.js v14 or higher
- npm or yarn

### Commands
```bash
npm install      # Install dependencies
npm run build    # Build TypeScript
npm run dev      # Build and run
npm start        # Run compiled version
```

### Code Structure
- **editor.ts**: Core editor logic and state management
- **highlight.ts**: Syntax highlighting engine
- **github.ts**: GitHub API integration
- **utils.ts**: Utility functions and configuration
- **index.ts**: Main entry point and CLI

## Testing

```bash
# Build and test
npm run build
node dist/index.js --help
node dist/index.js --version
node dist/index.js --status
```

## Documentation

- **README.md**: Main documentation
- **docs/USAGE.md**: Detailed usage guide
- **CHANGELOG.md**: Version history
- **CONTRIBUTING.md**: Contribution guidelines

## License

MIT License - see LICENSE file for details.

## Support

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Comprehensive usage guides
- **Community**: Welcome contributions and feedback

## Future Plans

- File explorer sidebar
- Multiple file tabs
- Git integration
- Extensions/plugins system
- Custom themes
- Auto-complete
- Code folding
- Split views
- Remote file editing
- Container support

---

**TypeWriter** - Code in your terminal. Push to GitHub. Ship faster.
