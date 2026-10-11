// Each event runs its own clock. Severity controls presentation, initial staggering and recovery time.
export const INTENSITY = {
  mild: { label: 'MILD', color: '#8bf4ac', cooldown: [35, 70], initial: [25, 75] },
  moderate: { label: 'MODERATE', color: '#ffe18a', cooldown: [70, 120], initial: [60, 130] },
  severe: { label: 'SEVERE', color: '#ff9966', cooldown: [120, 240], initial: [90, 210] },
  catastrophic: { label: 'CATASTROPHIC', color: '#ff5278', cooldown: [120, 240], initial: [120, 240] },
};
export const EVENTS = {
  ufo: { intensity: 'moderate', name: 'ALIEN ABDUCTION', warning: 8, duration: 27, hint: 'Dodge the green beam! If caught, use your parachute after the drop.' },
  godzilla: { intensity: 'severe', name: 'GODZILLA', warning: 10, duration: 48, hint: 'Clear the streets! Blue dorsal plates mean atomic breath is charging.' },
  tsunami: { intensity: 'severe', name: 'TSUNAMI', warning: 12, duration: 36, hint: 'A wave is approaching from the ocean! Get above 14 metres.' },
  volcano: { intensity: 'severe', name: 'VOLCANIC ERUPTION', warning: 10, duration: 44, hint: 'A volcano is rising! Keep away from the crater and red impact circles.' },
  meteors: { intensity: 'severe', name: 'METEOR SHOWER', warning: 8, duration: 36, hint: 'Watch the red impact circles and keep moving!' },
  tornado: { intensity: 'severe', name: 'TORNADO', warning: 10, duration: 40, hint: 'Stay clear of the funnel! It tears up cars and throws you into the air.' },
  cashrain: { intensity: 'mild', name: 'CASH RAIN', warning: 4, duration: 28, hint: 'Money is falling nearby! Run or drive over a landed bundle to collect it.' },
  fireworks: { intensity: 'mild', name: 'STREET FIREWORKS', warning: 4, duration: 24, hint: 'A harmless neighbourhood celebration — look up and enjoy the show!' },
  steam: { intensity: 'moderate', name: 'BURST STEAM MAINS', warning: 6, duration: 30, hint: 'Watch the glowing vents! Steam jets burn and launch you into the air.' },
  thunderstorm: { intensity: 'moderate', name: 'LIGHTNING STORM', warning: 8, duration: 38, hint: 'Lightning is targeting the glowing circles. Move before they strike!' },
  earthquake: { intensity: 'catastrophic', name: 'MEGAQUAKE', warning: 16, duration: 50, hint: 'Evacuate the cracked streets! Repeated tremors collapse whole blocks.' },
  invasion: { intensity: 'catastrophic', name: 'ALIEN INVASION', warning: 16, duration: 54, hint: 'Five saucers are attacking! Dodge their marked beams or shoot down the mothership.' },
  orbital: { intensity: 'catastrophic', name: 'ORBITAL ANNIHILATION', warning: 20, duration: 30, hint: 'Get outside the enormous red circle! Three orbital strikes will level entire blocks.' },
};
