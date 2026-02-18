// Quick test script to verify Gemini API
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;
const TOPIC = process.env.QUIZ_TOPIC || 'General Knowledge';

console.log('=== Gemini API Test ===');
console.log('API Key:', API_KEY ? `${API_KEY.substring(0, 10)}...` : 'NOT SET');
console.log('Topic:', TOPIC);
console.log('');

async function testGemini() {
    if (!API_KEY) {
        console.error('ERROR: GEMINI_API_KEY not set in environment');
        return;
    }

    try {
        // First, list available models using fetch
        console.log('Listing available models...');
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
        const listResponse = await fetch(listUrl);
        const listData = await listResponse.json();
        
        console.log('\n=== AVAILABLE MODELS ===');
        const models = listData.models || [];
        for (const model of models) {
            if (model.supportedGenerationMethods?.includes('generateContent')) {
                console.log(`- ${model.name}`);
            }
        }
        console.log('');
        
        // Find a model that supports generateContent
        const availableModel = models.find((m: any) => 
            m.supportedGenerationMethods?.includes('generateContent')
        );
        
        if (!availableModel) {
            console.error('No models available for generateContent');
            console.log('Full response:', JSON.stringify(listData, null, 2));
            return;
        }
        
        const modelName = availableModel.name.replace('models/', '');
        console.log(`Using model: ${modelName}`);
        
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `Generate 2 multiple-choice quiz questions about "${TOPIC}".

Respond ONLY with valid JSON in this EXACT format:
[
  {
    "text": "Question text here?",
    "options": {
      "A": "Option A text",
      "B": "Option B text",
      "C": "Option C text",
      "D": "Option D text"
    },
    "correct": "B",
    "category": "${TOPIC}"
  }
]`;

        console.log('Sending prompt to Gemini...');
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log('\n=== RAW RESPONSE ===');
        console.log(text.substring(0, 500));
        console.log('...');
        
        // Try to parse
        let jsonText = text.trim();
        if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```json?\n?/gi, '').replace(/```/g, '');
        }
        const startIndex = jsonText.indexOf('[');
        const endIndex = jsonText.lastIndexOf(']');
        if (startIndex !== -1 && endIndex !== -1) {
            jsonText = jsonText.substring(startIndex, endIndex + 1);
        }
        
        const parsed = JSON.parse(jsonText);
        console.log('\n=== PARSED QUESTIONS ===');
        console.log(JSON.stringify(parsed, null, 2));
        console.log('\n✅ SUCCESS! Gemini API is working correctly.');
        console.log(`\n📝 Update your .env file with: GEMINI_MODEL=${modelName}`);
        
    } catch (error) {
        console.error('\n❌ ERROR:', error);
    }
}

testGemini();