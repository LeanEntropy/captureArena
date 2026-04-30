// Shared navigation component for companion pages
// Add new pages to the pages array below
const pages = [
  { href: "character-design.html", label: "Character Design v1" },
  { href: "character-design-v2.html", label: "Character Design v2 (Box)" },
  { href: "visual-direction.html", label: "Visual Direction Plan" },
];

document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelector(".nav-links");
  if (!navLinks) return;

  for (const page of pages) {
    const a = document.createElement("a");
    a.href = page.href;
    a.textContent = page.label;
    if (window.location.pathname.endsWith(page.href)) {
      a.style.color = "#e94560";
    }
    navLinks.appendChild(a);
  }
});
