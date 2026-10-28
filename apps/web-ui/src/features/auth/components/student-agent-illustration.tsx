import type { SVGProps } from 'react';

/** Hình minh hoạ trang trí cho trang đăng nhập/đăng ký; id trong `defs` có tiền tố để tránh trùng. */
export function StudentAgentIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 520 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-auto w-full max-w-[420px] select-none drop-shadow-lg"
      {...props}
    >
      <defs>
        {/* Gradients */}
        <linearGradient
          id="sda-auth-orbitGlow"
          x1="260"
          y1="40"
          x2="260"
          y2="340"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>

        <linearGradient id="sda-auth-badgeGlass" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>

        <linearGradient id="sda-auth-aiBody" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>

        <linearGradient id="sda-auth-aiVisor" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>

        <linearGradient id="sda-auth-goldGradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fde047" />
          <stop offset="1" stopColor="#eab308" />
        </linearGradient>

        <linearGradient
          id="sda-auth-pathGradient"
          x1="80"
          y1="300"
          x2="440"
          y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#38bdf8" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#fde047" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.9" />
        </linearGradient>

        <filter id="sda-auth-softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Orbit Rings & Discovery Backdrop */}
      <circle
        cx="260"
        cy="190"
        r="145"
        stroke="url(#sda-auth-orbitGlow)"
        strokeWidth="1.5"
        strokeDasharray="6 6"
      />
      <circle
        cx="260"
        cy="190"
        r="105"
        stroke="url(#sda-auth-orbitGlow)"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <circle cx="260" cy="190" r="45" fill="#ffffff" fillOpacity="0.04" />

      {/* Career Trajectory Roadmap Curve */}
      <path
        d="M 90 310 C 140 290 190 260 240 210 C 290 160 360 120 440 90"
        stroke="url(#sda-auth-pathGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="6 8"
      />

      {/* Milestones on Career Curve */}
      <circle cx="160" cy="275" r="5" fill="#fde047" filter="url(#sda-auth-softGlow)" />
      <circle cx="240" cy="210" r="6" fill="#38bdf8" filter="url(#sda-auth-softGlow)" />
      <circle cx="340" cy="140" r="7" fill="#fb7185" filter="url(#sda-auth-softGlow)" />
      <circle cx="440" cy="90" r="9" fill="#fde047" filter="url(#sda-auth-softGlow)" />

      {/* Floating Badge 1: AI Career Match */}
      <g transform="translate(45, 60)">
        <rect
          width="135"
          height="42"
          rx="12"
          fill="url(#sda-auth-badgeGlass)"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="1"
        />
        <circle cx="22" cy="21" r="12" fill="#fde047" fillOpacity="0.25" />
        <path
          d="M 22 13 L 24.5 18 L 30 18.8 L 26 22.7 L 27 28.2 L 22 25.5 L 17 28.2 L 18 22.7 L 14 18.8 L 19.5 18 Z"
          fill="#fde047"
        />
        <text x="40" y="17" fill="#ffffff" fontSize="9" fontWeight="700" fontFamily="sans-serif">
          AI Career Match
        </text>
        <text x="40" y="30" fill="#93c5fd" fontSize="11" fontWeight="800" fontFamily="sans-serif">
          98% Phù hợp
        </text>
      </g>

      {/* Floating Badge 2: Holland / RIASEC Compass */}
      <g transform="translate(340, 40)">
        <rect
          width="140"
          height="44"
          rx="12"
          fill="url(#sda-auth-badgeGlass)"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="1"
        />
        <circle cx="22" cy="22" r="13" fill="#38bdf8" fillOpacity="0.2" />
        <polygon points="22,12 25,22 22,20 19,22" fill="#fb7185" />
        <polygon points="22,32 25,22 22,24 19,22" fill="#38bdf8" />
        <circle cx="22" cy="22" r="2.5" fill="#ffffff" />
        <text x="42" y="18" fill="#ffffff" fontSize="9.5" fontWeight="700" fontFamily="sans-serif">
          Định hướng GenZ
        </text>
        <text x="42" y="32" fill="#a7f3d0" fontSize="10.5" fontWeight="700" fontFamily="sans-serif">
          Holland: R-I-A
        </text>
      </g>

      {/* Floating Badge 3: Lộ trình tương lai */}
      <g transform="translate(355, 230)">
        <rect
          width="125"
          height="38"
          rx="10"
          fill="url(#sda-auth-badgeGlass)"
          stroke="#ffffff"
          strokeOpacity="0.25"
          strokeWidth="1"
        />
        <circle cx="20" cy="19" r="10" fill="#34d399" fillOpacity="0.25" />
        <path
          d="M 15 22 L 19 16 L 24 19 L 26 14"
          stroke="#34d399"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="36" y="16" fill="#ffffff" fontSize="9" fontWeight="600" fontFamily="sans-serif">
          Lộ trình THPT
        </text>
        <text x="36" y="28" fill="#e2e8f0" fontSize="10" fontWeight="700" fontFamily="sans-serif">
          12 Trường ĐBSCL
        </text>
      </g>

      {/* Graduation Cap floating near top */}
      <g transform="translate(230, 48) scale(0.9)">
        <polygon points="30,10 54,20 30,30 6,20" fill="#fde047" />
        <path d="M 14 24 L 14 36 C 14 42 46 42 46 36 L 46 24" fill="#eab308" opacity="0.9" />
        <circle cx="30" cy="20" r="2.5" fill="#ffffff" />
        <path d="M 30 20 L 52 26 L 52 38" stroke="#fef08a" strokeWidth="1.5" fill="none" />
        <circle cx="52" cy="38" r="2" fill="#fef08a" />
      </g>

      {/* Lightbulb (Insight/Creative) */}
      <g transform="translate(70, 195) scale(0.85)">
        <circle cx="20" cy="20" r="14" fill="#fb7185" fillOpacity="0.2" />
        <path
          d="M 15 22 C 14 18 15 15 17 13 C 19 11 23 11 25 13 C 27 15 27 18 26 21 L 24 24 L 17 24 Z"
          fill="#fb7185"
        />
        <rect x="18" y="25" width="5" height="2" rx="1" fill="#fecdd3" />
        <rect x="19" y="28" width="3" height="1.5" rx="0.75" fill="#fecdd3" />
        <line
          x1="20"
          y1="6"
          x2="20"
          y2="9"
          stroke="#fda4af"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="9"
          y1="13"
          x2="11"
          y2="15"
          stroke="#fda4af"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="31"
          y1="13"
          x2="29"
          y2="15"
          stroke="#fda4af"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>

      {/* STUDENT CHARACTER (Left & Center) */}
      <g>
        {/* Ground shadow */}
        <ellipse cx="195" cy="355" rx="55" ry="8" fill="#1e293b" fillOpacity="0.3" />

        {/* Legs / Jeans */}
        <path d="M 180 295 L 172 345 L 188 347 L 194 300 Z" fill="#1e293b" />
        <path d="M 200 295 L 206 345 L 222 345 L 214 298 Z" fill="#0f172a" />
        {/* Sneakers */}
        <path
          d="M 166 343 C 166 343 162 349 164 353 C 166 355 186 355 190 353 C 190 348 186 344 186 344 Z"
          fill="#ffffff"
        />
        <rect x="166" y="350" width="24" height="3" rx="1.5" fill="#f43f5e" />
        <path
          d="M 204 343 C 204 343 202 349 204 353 C 206 355 226 355 228 353 C 228 348 224 344 224 344 Z"
          fill="#ffffff"
        />
        <rect x="204" y="350" width="24" height="3" rx="1.5" fill="#38bdf8" />

        {/* Backpack strap & pocket */}
        <path
          d="M 165 220 C 158 245 158 275 166 295"
          stroke="#047857"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="152" y="235" width="14" height="42" rx="7" fill="#10b981" />

        {/* Hoodie / Jacket (GenZ Yellow & White) */}
        <path
          d="M 172 210 C 182 205 212 205 224 210 L 230 295 C 215 300 182 300 168 295 Z"
          fill="url(#sda-auth-goldGradient)"
        />
        {/* Hoodie cord & neckline */}
        <path d="M 190 210 Q 198 228 206 210" stroke="#713f12" strokeWidth="2" fill="none" />
        <line
          x1="194"
          y1="218"
          x2="194"
          y2="238"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="202"
          y1="218"
          x2="202"
          y2="235"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Head & Neck */}
        <rect x="192" y="196" width="12" height="15" rx="5" fill="#fed7aa" />
        <circle cx="198" cy="178" r="21" fill="#fed7aa" />

        {/* Hair (Modern stylish GenZ cut) */}
        <path
          d="M 178 174 C 178 160 188 152 202 152 C 216 152 222 162 222 172 C 216 168 208 166 200 166 C 190 166 182 170 178 174 Z"
          fill="#1c1917"
        />
        <path d="M 176 172 C 174 182 176 190 178 194 C 181 190 182 182 181 176 Z" fill="#1c1917" />
        {/* Gentle face features */}
        <circle cx="206" cy="176" r="2" fill="#1c1917" />
        <path
          d="M 203 184 Q 207 188 212 184"
          stroke="#c2410c"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Ear & Earphone */}
        <circle cx="188" cy="179" r="3.5" fill="#fed7aa" />
        <circle cx="188" cy="179" r="2" fill="#ffffff" />

        {/* Left Arm holding Digital Tablet */}
        <path
          d="M 172 215 L 160 250 L 195 260"
          stroke="url(#sda-auth-goldGradient)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Right Arm gesturing towards AI Bot */}
        <path
          d="M 224 216 L 244 240 L 268 226"
          stroke="url(#sda-auth-goldGradient)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="270" cy="225" r="5" fill="#fed7aa" />

        {/* Digital Career Tablet */}
        <g transform="translate(185, 240) rotate(-10)">
          <rect width="46" height="34" rx="5" fill="#0f172a" stroke="#ffffff" strokeWidth="1.5" />
          <rect x="4" y="4" width="38" height="26" rx="3" fill="#1e293b" />
          <rect x="7" y="7" width="16" height="3" rx="1.5" fill="#38bdf8" />
          <rect x="7" y="13" width="22" height="2" rx="1" fill="#94a3b8" />
          <rect x="7" y="18" width="14" height="2" rx="1" fill="#94a3b8" />
          <path
            d="M 28 24 L 32 18 L 36 21 L 40 14"
            stroke="#fde047"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="8" cy="26" r="4.5" fill="#fed7aa" />
        </g>
      </g>

      {/* AI AGENT COMPANION BOT (Right) */}
      <g transform="translate(295, 140)">
        {/* Bot Glow aura */}
        <ellipse
          cx="48"
          cy="52"
          rx="42"
          ry="46"
          fill="#38bdf8"
          fillOpacity="0.15"
          filter="url(#sda-auth-softGlow)"
        />

        {/* Floating shadow */}
        <ellipse cx="48" cy="115" rx="26" ry="5" fill="#1e293b" fillOpacity="0.25" />

        {/* Antenna */}
        <line
          x1="48"
          y1="20"
          x2="48"
          y2="8"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="48" cy="6" r="4" fill="#fde047" filter="url(#sda-auth-softGlow)" />

        {/* Bot Head Body (Smooth Rounded Mascot) */}
        <rect
          x="16"
          y="18"
          width="64"
          height="54"
          rx="22"
          fill="url(#sda-auth-aiBody)"
          stroke="#ffffff"
          strokeWidth="1.5"
          className="drop-shadow-md"
        />

        {/* Visor Screen */}
        <rect x="24" y="27" width="48" height="32" rx="12" fill="url(#sda-auth-aiVisor)" />

        {/* Friendly Cheerful Glowing Eyes: ^ ^ */}
        <path
          d="M 33 44 C 34 38 40 38 41 44"
          stroke="#38bdf8"
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          filter="url(#sda-auth-softGlow)"
        />
        <path
          d="M 55 44 C 56 38 62 38 63 44"
          stroke="#38bdf8"
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          filter="url(#sda-auth-softGlow)"
        />

        {/* Blushing cheeks */}
        <circle cx="31" cy="48" r="2.5" fill="#fb7185" fillOpacity="0.7" />
        <circle cx="65" cy="48" r="2.5" fill="#fb7185" fillOpacity="0.7" />

        {/* Lower floating body / thruster */}
        <path d="M 32 72 C 32 72 36 94 48 94 C 60 94 64 72 64 72 Z" fill="url(#sda-auth-aiBody)" />
        <circle cx="48" cy="80" r="4" fill="#4963a8" />
        <circle cx="48" cy="80" r="2" fill="#38bdf8" />

        {/* Thruster light pulse */}
        <path
          d="M 42 95 C 44 102 52 102 54 95 Z"
          fill="#38bdf8"
          opacity="0.8"
          filter="url(#sda-auth-softGlow)"
        />

        {/* Left Waving Hand */}
        <g transform="translate(10, 50)">
          <path d="M 12 12 C 4 6 -2 -2 2 -8 C 6 -12 14 -4 14 6 Z" fill="url(#sda-auth-aiBody)" />
          <circle cx="2" cy="-8" r="3.5" fill="#fde047" />
        </g>

        {/* Right Friendly Hand */}
        <g transform="translate(72, 54)">
          <path d="M 2 10 C 10 14 16 20 18 26 C 18 30 12 30 8 22 Z" fill="url(#sda-auth-aiBody)" />
          <circle cx="16" cy="26" r="3" fill="#38bdf8" />
        </g>

        {/* Chat speech bubble coming from AI */}
        <g transform="translate(68, -15)">
          <path
            d="M 0 25 L 8 20 H 42 C 48 20 52 16 52 10 C 52 4 48 0 42 0 H 10 C 4 0 0 4 0 10 V 25 Z"
            fill="#ffffff"
            filter="url(#sda-auth-softGlow)"
          />
          <text x="11" y="13" fill="#0f172a" fontSize="8" fontWeight="800" fontFamily="sans-serif">
            Hi GenZ! ✨
          </text>
        </g>
      </g>

      {/* Sparkles around */}
      <g fill="#ffffff" opacity="0.8">
        <path d="M 280 90 Q 280 96 286 96 Q 280 96 280 102 Q 280 96 274 96 Q 280 96 280 90 Z" />
        <path d="M 130 130 Q 130 134 134 134 Q 130 134 130 138 Q 130 134 126 134 Q 130 134 130 130 Z" />
        <path d="M 470 170 Q 470 175 475 175 Q 470 175 470 180 Q 470 175 465 175 Q 470 175 470 170 Z" />
        <circle cx="310" cy="80" r="1.5" fill="#fde047" />
        <circle cx="160" cy="110" r="1.5" fill="#38bdf8" />
        <circle cx="330" cy="310" r="1.5" fill="#ffffff" />
      </g>
    </svg>
  );
}
