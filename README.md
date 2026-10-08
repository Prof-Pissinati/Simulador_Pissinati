# Simulador de Sistemas de Potência (IEEE 53 barras)

Simulador de fluxo de potência e reconfiguração de redes de distribuição. Veja o [MANUAL.md](MANUAL.md).

## Como executar no navegador

**Opção 1 — sem instalar nada:** baixe [`standalone/simulador.html`](standalone/simulador.html) e abra com duplo clique
(arquivo único, com todo o código embutido; o mapa precisa de internet para carregar os tiles).

**Opção 2 — GitHub Pages:** a cada push na `main`, o workflow `.github/workflows/pages.yml` publica a versão atual.
Ative uma vez em *Settings → Pages → Source: GitHub Actions*.

**Opção 3 — desenvolvimento:** `npm install` e `npm run dev`.

### Gerar o arquivo único novamente
```bash
npm run build:standalone   # gera dist/index.html e copia para standalone/simulador.html
```
A pasta `dist/` continua no `.gitignore`; o que é versionado é `standalone/simulador.html`.
Lembre de regenerar e commitar esse arquivo quando alterar o código.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
