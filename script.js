'use strict';

const header   = document.getElementById('site-header');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const bottomBar = document.getElementById('bottom-bar');
const mmLinks   = mobileMenu.querySelectorAll('.mm-link, .mm-book');

let menuOpen    = false;
let lastY       = 0;
let ticking     = false;
let counted     = false;

/* ── MENU ─────────────────────────────────────────────────── */
function openMenu() {
  menuOpen = true;
  mobileMenu.classList.add('open');
  hamburger.classList.add('open');
  hamburger.setAttribute('aria-expanded','true');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  menuOpen = false;
  mobileMenu.classList.remove('open');
  hamburger.classList.remove('open');
  hamburger.setAttribute('aria-expanded','false');
  document.body.style.overflow = '';
}

hamburger.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
mmLinks.forEach(l => l.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) closeMenu(); });

/* ── SCROLL ───────────────────────────────────────────────── */
function handleScroll() {
  const y = window.scrollY;

  // Header glass
  header.classList.toggle('scrolled', y > 24);

  // Bottom bar hide/show on scroll direction
  if (bottomBar) {
    if (y > lastY + 6 && y > 100) bottomBar.classList.add('hide');
    else if (y < lastY - 4)       bottomBar.classList.remove('hide');
  }
  lastY = y;
  ticking = false;
}

window.addEventListener('scroll', () => {
  if (!ticking) { requestAnimationFrame(handleScroll); ticking = true; }
}, { passive: true });

/* ── REVEAL ON SCROLL ─────────────────────────────────────── */
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

/* Hero fires immediately on load */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    document.querySelectorAll('.hero .reveal').forEach(el => el.classList.add('in'));
  }, 180);
});

/* ── BOOKING MODAL (WhatsApp & Call) ──────────────────────── */
const bookingModal    = document.getElementById('booking-modal');
const modalClose      = document.getElementById('modal-close');
const bookingTriggers = document.querySelectorAll('.trigger-booking, a[href="#booking-modal"]');

function openBookingModal(e) {
  if (e) e.preventDefault();
  if (menuOpen) closeMenu();
  if (bookingModal) {
    bookingModal.classList.add('open');
    bookingModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
}

function closeBookingModal() {
  if (bookingModal) {
    bookingModal.classList.remove('open');
    bookingModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
}

bookingTriggers.forEach(btn => {
  btn.addEventListener('click', openBookingModal);
});

if (modalClose) {
  modalClose.addEventListener('click', closeBookingModal);
}

if (bookingModal) {
  bookingModal.addEventListener('click', e => {
    if (e.target === bookingModal) closeBookingModal();
  });
}

// Update escape key listener
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (menuOpen) closeMenu();
    closeBookingModal();
  }
});

/* ── SMOOTH ANCHORS ───────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#booking-modal' || a.classList.contains('trigger-booking')) return;
    const t = document.querySelector(href);
    if (!t) return;
    e.preventDefault();
    window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - header.offsetHeight, behavior: 'smooth' });
  });
});

/* ── PARALLAX (desktop only) ──────────────────────────────── */
const heroBody = document.querySelector('.hero-body');
if (heroBody && window.matchMedia('(min-width:960px)').matches) {
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y < window.innerHeight) heroBody.style.transform = `translateY(${y * 0.1}px)`;
  }, { passive: true });
}

/* ── HOW TO INSERT YOUR 3D ANIMATION ─────────────────────────
   Find <div id="hero-animation"> in index.html and replace the
   placeholder content with any of:

   MP4 / WebM:
   ───────────
   <video autoplay muted loop playsinline poster="poster.jpg">
     <source src="hero.webm" type="video/webm">
     <source src="hero.mp4"  type="video/mp4">
   </video>

   Three.js / WebGL — mount canvas:
   ─────────────────────────────────
   const c = document.getElementById('hero-animation');
   c.innerHTML = '';
   c.appendChild(yourThreeJsCanvas);

   Spline / Rive / iframe:
   ────────────────────────
   <iframe src="https://my.spline.design/..." allowfullscreen></iframe>

   To adjust how dark the veil overlay is, edit .hero-veil in style.css.
   ─────────────────────────────────────────────────────────────────── */
