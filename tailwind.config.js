/** @type {import('tailwindcss').Config} */
module.exports = {  
  content: [
      "./public/**/*.html",          // all your static pages
    "./src/**/*.{js,ts,jsx,tsx}",  // if any client scripts add classes
    "./views/**/*.{html,ejs}"      // if you have server templates
  ],  
  theme: { extend: {} },
  corePlugins: { preflight: false },
     container: false,  // <- stops Tailwind from outputting .container
  plugins: [],
}
