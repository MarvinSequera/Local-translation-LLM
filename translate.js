const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const sourceLang = 'en';
const targetLang = 'es';

// Configuration details moved to a separate file (config.js)
const config = require('./config.js');
const apiUrl = config.apiUrl;
const modelName = config.modelName;

const variable = process.argv[2];
const program = process.argv[3];
const hasFolderInsideVariable = process.argv[4];

// --- MAIN PROCESS ---
async function processVideos(folder, name, hasFolderInside) {
    let hasFolderInsideBoolean = false;
    if (hasFolderInside !== undefined && hasFolderInside.toLowerCase() === 'true') {
        hasFolderInsideBoolean = true;
    }

    if (!folder) {
        console.log("No folder add it as a parameter");
        return;
    }
    const location = process.cwd();
    const parentDir = path.dirname(location);
    if (!name) {
        console.log(fs.readdirSync(parentDir + '/' + folder));
        return;
    }
    
    const completePath = parentDir + '/' + folder + '/' + name;
    if (!hasFolderInsideBoolean) {
        const files = fs.readdirSync(completePath).filter(f => f.endsWith('.mkv'));
        if (!files.length) {
            console.log('No files found');
            return;
        }
        for (const [index, file] of files.entries()) {
            console.log(`\n--- Processing: ${index + 1} of ${files.length} ---`);
            console.log(`--- File: ${file} ---`);
            const completeFilePath = completePath + '/' + file;
            const tempSrt = `/dev/shm/temp_extract.srt`;
            try {
                const metadata = JSON.parse(execSync(`mkvmerge -J "${completeFilePath}"`).toString());
                const subTrack = metadata.tracks.find(t => 
                    t.type === 'subtitles' && 
                    ['S_TEXT/UTF8', 'S_TEXT/ASS'].includes(t.properties.codec_id)
                );

                if (!subTrack) {
                    console.log(`Skipping: No compatible subtitles found in ${file}`);
                    continue;
                }
                
                const finalSrt = path.join(completePath, file.replace('.mkv', `.${targetLang}.srt`));
                console.log(`Extracting Track ID ${subTrack.id} (${subTrack.properties.codec_id})...`);

                execSync(`ffmpeg -y -i "${completeFilePath}" -map 0:${subTrack.id} "${tempSrt}"`, { stdio: 'ignore' });

                // --- SMART BATCH PROCESSING ---
                const content = fs.readFileSync(tempSrt, 'utf-8');
                const lines = content.split('\n');
                const translatedLines = await translateSrtContent(lines);

                fs.writeFileSync(finalSrt, translatedLines.join('\n'));
                console.log(`Success! Saved to: ${finalSrt}`);

            } catch (err) {
                console.error(`Error processing ${file}:`, err.message);
            } finally {
                if (fs.existsSync(tempSrt)) fs.unlinkSync(tempSrt);
            }
        }

    } else {
        const folders = fs.readdirSync(completePath)
        for(const [folderIndex, folder] of folders.entries()) {
            console.log(`\n--- Processing folder: ${folderIndex + 1} of ${folders.length} ---`);
            const completeFolderPath = completePath + '/' + folder
            const files = fs.readdirSync(completeFolderPath).filter(f => f.endsWith('.mkv'));
            for (const [fileIndex, file] of files.entries()) {
                console.log(`\n--- Files to process: ${files.length} ---`);
                console.log(`--- Processing: ${fileIndex + 1} of ${files.length} ---`);
                console.log(`--- File: ${file} ---`);
                const completeFilePath = completeFolderPath + '/' + file;
                const tempSrt = `/dev/shm/temp_extract.srt`;
                try {
                    const metadata = JSON.parse(execSync(`mkvmerge -J "${completeFilePath}"`).toString());
                    const subTrack = metadata.tracks.find(t => 
                        t.type === 'subtitles' && 
                        ['S_TEXT/UTF8', 'S_TEXT/ASS'].includes(t.properties.codec_id)
                    );

                    if (!subTrack) {
                        console.log(`Skipping: No compatible subtitles found in ${file}`);
                        continue;
                    }
                    
                    const finalSrt = path.join(completeFolderPath, file.replace('.mkv', `.${targetLang}.srt`));
                    console.log(`Extracting Track ID ${subTrack.id} (${subTrack.properties.codec_id})...`);

                    execSync(`ffmpeg -y -i "${completeFilePath}" -map 0:${subTrack.id} "${tempSrt}"`, { stdio: 'ignore' });

                    // --- SMART BATCH PROCESSING ---
                    const content = fs.readFileSync(tempSrt, 'utf-8');
                    const lines = content.split('\n');
                    const translatedLines = await translateSrtContent(lines);

                    fs.writeFileSync(finalSrt, translatedLines.join('\n'));
                    console.log(`Success! Saved to: ${finalSrt}`);

                } catch (err) {
                    console.error(`Error processing ${file}:`, err.message);
                } finally {
                    if (fs.existsSync(tempSrt)) fs.unlinkSync(tempSrt);
                }
            }
        }
    }
}

// --- HELPER TO CHUNK AND RECONSTITUTE SRT LINES ---
async function translateSrtContent(lines, outputFolder, fileName) {
    const reconstitutedLines = [];
    let textBatch = [];
    let indexBatch = [];
    let timestampBatch = [];

    console.log(`Analyzing file lines... Total lines found: ${lines.length}`);

    let lastTimestamp = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('-->')) {
            lastTimestamp = line.trim();
        }

        if (line.trim() === '' || !isNaN(line.trim()) || line.includes('-->')) {
            reconstitutedLines[i] = line;
        } else {
            textBatch.push(line.trim());
            indexBatch.push(i);
            timestampBatch.push(lastTimestamp);
            
            if (textBatch.length >= 20 || i === lines.length - 1) {
                const translatedBatch = await translateBatch(textBatch, outputFolder, fileName, timestampBatch);
                
                for (let b = 0; b < indexBatch.length; b++) {
                    const originalIndex = indexBatch[b];
                    reconstitutedLines[originalIndex] = translatedBatch[b] || textBatch[b];
                }
                
                textBatch = [];
                indexBatch = [];
                timestampBatch = [];
            }
        }
    }
    return reconstitutedLines;
}

// --- OLLAMA TRANSLATION API HELPER (WITH SELF-HOSTED DOCKER FALLBACK) ---
async function translateBatch(textArray, outputFolder, fileName, timestampArray) {
    const maxRetries = 3;
    let attempt = 0;
    let currentTemperature = 0.1;

    // Configuration for your backup Docker container
    const dockerBackupUrl = 'http://localhost:5000/translate'; 

    // ANSI Colors
    const RED = "\x1b[31m";
    const GREEN = "\x1b[32m";
    const YELLOW = "\x1b[33m";
    const RESET = "\x1b[0m";

    while (attempt < maxRetries) {
        attempt++;
        const controller = new AbortController();
        
        try {
            console.log(`[TRANSLATE BATCH] Attempt ${attempt}: Translating ${textArray.length} lines...`);
            const systemPrompt = `You are an expert subtitle translator. Translate this JSON array of English sentences into Spanish.
Rules:
- Translate line-by-line accurately reflecting movie/TV show context.
- Maintain the exact same number of elements in the array.
- You must respond ONLY with a JSON object containing a "translations" array key.
- Example Output Format: {"translations": ["texto 1", "texto 2", "texto 3"]}
- Do not add conversational text, commentary, or markdown blocks.`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: "user", content: `${systemPrompt}\n\nArray to translate: ${JSON.stringify(textArray)}` }
                    ],
                    stream: false,
                    format: "json", 
                    options: { temperature: currentTemperature }
                })
            });

            const data = await response.json();
            const rawContent = data.message?.content;

            if (!rawContent) throw new Error("Empty response payload.");

            const parsedJson = JSON.parse(rawContent.trim());
            console.log(`${GREEN}[BATCH COMPLETED]`)
            let finalArray = null;
            if (Array.isArray(parsedJson)) {
                finalArray = parsedJson;
            } else if (parsedJson.translations && Array.isArray(parsedJson.translations)) {
                finalArray = parsedJson.translations;
            } else if (parsedJson.translation && Array.isArray(parsedJson.translation)) {
                finalArray = parsedJson.translation;
            }

            if (finalArray && finalArray.length === textArray.length) {
                if (attempt > 1) {
                    console.log(`${GREEN}[RECOVERY SUCCESS] Batch resolved successfully on attempt ${attempt}!${RESET}`);
                }
                return finalArray;
            }

            throw new Error("JSON response layout mismatch.");

        } catch (err) {
            console.error(`${RED}[BATCH WARNING] Attempt ${attempt} failed formatting.${RESET}`);
            currentTemperature += 0.15; 
            
            if (attempt >= maxRetries) {
                console.error(`${YELLOW}[BATCH CRITICAL] TranslateGemma structure failed. Forwarding chunk to Docker 
Backup...${RESET}`);
                const fallbackArray = [];
                
                for (let j = 0; j < textArray.length; j++) {
                    const singleLine = textArray[j];
                    try {
                        // Send single line to the LibreTranslate Docker container
                        const dockerResponse = await fetch(dockerBackupUrl, {
                            method: 'POST',
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                q: singleLine,
                                source: 'en',
                                target: 'es',
                                format: 'text'
                            })
                        });

                        const dockerData = await dockerResponse.json();
                        const translatedText = dockerData.translatedText;

                        if (translatedText) {
                            fallbackArray.push(translatedText.trim());
                            console.log(`${GREEN}  [DOCKER SUCCESS] Line ${j+1}/${textArray.length}: 
"${translatedText.trim()}"${RESET}`);
                        } else {
                            throw new Error("No text returned from container.");
                        }
                    } catch (dockerErr) {
                        // Hard absolute fallback: drop the original English text if Docker is down
                        console.error(`${RED}  [DOCKER FAILED] Falling back to English for line: "${singleLine}"${RESET}`);
                        fallbackArray.push(singleLine);
                    }
                }
                return fallbackArray;
            }
        }
    }
}

processVideos(variable, program, hasFolderInsideVariable);