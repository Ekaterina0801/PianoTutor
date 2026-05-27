import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      boxShadow: { soft: "0 10px 30px rgba(0,0,0,0.35)" },
      borderRadius: { xl2: "1.25rem", xl3: "1.75rem" },
    },
  },
  plugins: [],
};
export default config;
