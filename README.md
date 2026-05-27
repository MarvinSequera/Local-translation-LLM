# Local-translation-LLM
Translate System using local Docker and LLM
# Subtitle Translation Tool

  A Node.js automation tool for extracting and translating embedded subtitles from MKV video files.

  ## Features

  - ✅ Extracts subtitle tracks from `.mkv` files using `mkvmerge`
  - ✅ Batches subtitle lines into chunks (max 20) for efficient translation
  - ✅ Translates subtitles using Ollama (local AI model) with built-in retry logic
  - ✅ Falls back to a self-hosted LibreTranslate Docker container on AI failure
  - ✅ Generates `.es.srt` files in the same directory structure as source videos
  - ✅ Supports nested folder processing

  ## Setup

  1. MKV Metadata Tool
  Ensure mkvmerge is installed:
  # Ubuntu/Debian
  sudo apt install mkvtoolnix
  # macOS
  brew install mkvtoolnix

  2. Ollama Model
  Pull the translation model:
  ollama pull translategemma:4b

  3. Configure Settings
  Edit config.js to match your environment:
  module.exports = {
      apiUrl: 'http://localhost:11434/api/chat',
      modelName: 'translategemma:4b'
  };

  Usage

  Single Video File

  node translate.js <video-file> <output-language-code>
  Example:
  node translate.js "movies/matrix.mkv" es

  Batch Video Files

  node translate.js <folder-path> <output-language-code>
  Example:
  node translate.js "movies/" es
  Processes all .mkv files in the specified folder.

  Nested Folder Support

  To process subfolders, add a fourth argument:
  node translate.js <folder-path> <output-language-code> true
  Example:
  node translate.js "seasons/season-1/" es true

  Output

  The tool creates new .es.srt files in the same folder as the source .mkv files, preserving directory structure.

  How It Works

  1. Extraction: Uses mkvmerge -J to extract subtitle track metadata and content via ffmpeg.
  2. Chunking: Splits subtitle lines into batches of up to 20 lines per request.
  3. Translation: Sends batches to Ollama API with a system prompt enforcing JSON output.
  4. Fallback: On AI failure, routes lines to the LibreTranslate Docker container.
  5. Reassembly: Reassembles translated lines into a valid .srt file format.

  Error Handling

  - Missing subtitle tracks: Skips file with a warning
  - API errors: Retries up to 3 times before fallback
  - Docker container offline: Uses original English text as final fallback

  License

  MIT
