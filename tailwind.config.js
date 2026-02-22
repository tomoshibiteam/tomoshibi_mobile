/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#F8F7F6",
        primary: "#EE8C2B",
        "primary-hover": "#D97B1E",
        foreground: "#221910",
        muted: "#6C5647",
        border: "#E7D9C7",
      },
    },
  },
  plugins: [],
};
