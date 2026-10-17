import "dotenv/config";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as github from "@actions/github";

// 1. Inicializar Gemini y GitHub
const apiKey = process.env.GEMINI_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;

if (!apiKey || !githubToken) {
    throw new Error("Faltan variables en el archivo .env (GEMINI_API_KEY o GITHUB_TOKEN)");
}

const genAI = new GoogleGenerativeAI(apiKey);
const octokit = github.getOctokit(githubToken);

const model = genAI.getGenerativeModel({
    model: "gemini-3.7-flash",
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
                aprobado: { type: SchemaType.BOOLEAN, description: "true si cumple las reglas" },
                motivo: { type: SchemaType.STRING, description: "Explicación de por qué se aprueba o rechaza" }
            },
            required: ["aprobado", "motivo"],
        },
    },
});

async function analizarPRReal() {
    // Leemos el contexto mágico que inyecta GitHub Actions
    const contexto = github.context;

    if (!contexto.payload.pull_request) {
        console.log("Este evento no es un Pull Request. Finalizando ejecución.");
        return;
    }

    const owner = contexto.repo.owner;
    const repo = contexto.repo.repo;
    const prNumber = contexto.payload.pull_request.number;

    console.log(`Conectando a GitHub para leer el PR #${prNumber}...`);

    try {
        const { data: diffDelCodigo } = await octokit.rest.pulls.get({
            owner: owner,
            repo: repo,
            pull_number: prNumber,
            mediaType: { format: "diff" },
        });

        console.log("Código descargado. Enviando a Gemini...");

        // === TUS NUEVAS REGLAS DE JAVA ===
        const reglas = `
      Eres un Arquitecto de Software estricto revisando un Pull Request de código Java. 
      Evalúa el siguiente diff de código basándote ÚNICAMENTE en estas 4 reglas de calidad:
      
      1. No debe haber textos literales (Hardcoded Strings) dentro de las clases Java a excepción de símbolos, guiones, signos de interrogación y exclamaciones.
      2. No debe haber llamadas a 'System.out' en el código nuevo agregado.
      3. No debe haber llamadas a 'printStackTrace' en el código nuevo agregado.
      4. No debe haber concatenaciones de strings usando el operador '+' dentro de estructuras de bucles (for, forEach, while).
      
      Si el código incumple AL MENOS UNA de estas reglas, debes rechazarlo e indicar exactamente qué regla se rompió y en qué línea o bloque.
    `;

        const resultado = await model.generateContent(`${reglas}\n\nCódigo Diff:\n${String(diffDelCodigo)}`);
        const respuestaJSON = JSON.parse(resultado.response.text());

        console.log("\n--- RESULTADO DEL ANÁLISIS ---");
        console.log(`¿Aprobado?: ${respuestaJSON.aprobado ? "✅ SÍ" : "❌ NO"}`);
        console.log(`Motivo: ${respuestaJSON.motivo}`);

        console.log("\nEnviando respuesta a GitHub...");

        const eventoGitHub = respuestaJSON.aprobado ? "APPROVE" : "REQUEST_CHANGES";

        const cuerpoComentario = `### Revisión Automática de Arquitectura Java 🤖☕
**Estado:** ${respuestaJSON.aprobado ? "Aprobado ✅" : "Requiere Cambios ❌"}
**Motivo:** ${respuestaJSON.motivo}`;

        await octokit.rest.pulls.createReview({
            owner: owner,
            repo: repo,
            pull_number: prNumber,
            body: cuerpoComentario,
            event: eventoGitHub,
        });

        console.log("¡Revisión publicada exitosamente en GitHub!");

    } catch (error) {
        console.error("Hubo un error al conectar con GitHub o analizar el PR:", error);
    }
}

analizarPRReal();