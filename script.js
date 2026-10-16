// Detección de dispositivo real: el viewport está forzado a 1024 en móviles,
// así que las media queries normales no se disparan. Usamos device-width / userAgent
// (excluyendo TVs) para saber cuándo es un teléfono real.
(function () {
    try {
        var ua = navigator.userAgent;
        // Detección de TV real (Smart TV, TV boxes como ONN Watch TV, Google TV,
        // Fire TV...): se detecta ANTES que móvil para que reciban el modo TV
        // (modal ancho 16:9 y sin efectos pesados que congelan el video).
        var isTV = /(Tizen|Web0S|WebOS|SMART-TV|SmartTV|BRAVIA|Viera|Android TV|GoogleTV|Chromecast|AFT[A-Z]|ADT-|ONN|Roku|Xbox|PlayStation|Fire ?TV|MiBox|Mi ?TV|Hisense|Vestel|Philips TV|Panasonic)/i.test(ua);
        try {
            if (!isTV && navigator.userAgentData && navigator.userAgentData.brands &&
                navigator.userAgentData.brands.some(function (b) { return /Google TV|Android TV/i.test(b.brand); })) {
                isTV = true;
            }
        } catch (e2) { }
        if (isTV) {
            document.documentElement.classList.add('is-tv');
        }
        var mqMobile = window.matchMedia && window.matchMedia('(max-device-width: 900px)').matches;
        var smallScreen = window.screen && window.screen.width > 0 && window.screen.width <= 900;
        var uaMobile = /iPhone|iPad|iPod|Android(?! TV)|Opera Mini|IEMobile|Mobile/i.test(ua);
        if (!isTV && (mqMobile || smallScreen || uaMobile)) {
            document.documentElement.classList.add('is-mobile');
        }
        // Modo bajo consumo: TV boxes, Smart TV y móviles gama baja.
        // Se apagan las animaciones/efectos pesados de GPU para que la página
        // sea fluida y rápida en dispositivos con hardware limitado.
        var isLowPower = false;
        try {
            var cores = navigator.hardwareConcurrency || 8;
            var mem = navigator.deviceMemory || 8;
            isLowPower = isTV || (uaMobile && (cores <= 4 || mem <= 4));
        } catch (e3) {
            isLowPower = isTV;
        }
        if (isLowPower) {
            document.documentElement.classList.add('is-low-power');
        }
    } catch (e) { }
})();

// PWA: registrar el Service Worker para instalación y soporte offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js')
            .then(function (reg) {
                // Buscar version nueva en cada carga y cada 30 minutos
                try { reg.update(); } catch (e) { }
                setInterval(function () { try { reg.update(); } catch (e) { } }, 30 * 60 * 1000);
            })
            .catch(function (err) {
                console.error('Error registrando Service Worker:', err);
            });
    });

    // Cuando la version nueva toma el control, recargar UNA sola vez para que
    // el usuario reciba los cambios sin hacer nada (y sin bucles).
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        try {
            if (sessionStorage.getItem('***') === '1') return;
            sessionStorage.setItem('***', '1');
            window.location.reload();
        } catch (e) { }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Audio Player Logic
    const streamUrl = 'https://stream.zeno.fm/zadzh811p48uv';
    const audio = new Audio(streamUrl);
    const playBtn = document.getElementById('play-btn');
    const headerPlayBtn = document.getElementById('header-play-btn');
    const heroLogo = document.getElementById('hero-logo');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeIcon = document.getElementById('volume-icon');
    const icon = playBtn.querySelector('i');
    const headerIcon = headerPlayBtn ? headerPlayBtn.querySelector('i') : null;
    const songTitleElement = document.getElementById('song-title');
    let isPlaying = false;
    // Modo bajo consumo activo (TV boxes, Smart TV, móviles gama baja):
    // se omiten los efectos que dependen del mouse y animaciones de GPU.
    const lowPowerMode = document.documentElement.classList.contains('is-low-power');
    // La radio se pausa mientras suena el video de noticias o un Top Crazy,
    // y se reanuda sola en cuanto se pausan o terminan.
    let radioPausedForVideo = false;
    let radioPausedForTop5 = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let connectionLost = false;
    const RECONNECT_BASE_MS = 2000;   // primer reintento a los 2s
    const RECONNECT_MAX_MS = 30000;   // máximo 30s entre intentos

    function syncPlayState() {
        if (icon) {
            icon.classList.remove('fa-pause', 'fa-play');
            icon.classList.add(isPlaying ? 'fa-pause' : 'fa-play');
        }
        if (headerIcon) {
            headerIcon.classList.remove('fa-pause', 'fa-play');
            headerIcon.classList.add(isPlaying ? 'fa-pause' : 'fa-play');
        }
    }

    // === La radio nunca se queda en silencio ===
    // Guardamos el estado de reproducción y, al volver a la página (botón
    // "atrás" del teléfono tras leer una noticia, cambio de pestaña, cierre
    // de la TV o recarga tras navegar fuera), la radio se reanuda sola.
    const RADIO_STATE_KEY = 'mcr_radio_playing';

    function persistPlayState() {
        try {
            if (isPlaying) sessionStorage.setItem(RADIO_STATE_KEY, '1');
            else sessionStorage.removeItem(RADIO_STATE_KEY);
        } catch (e) { }
    }

    function resumeRadioIfPaused() {
        try {
            if (sessionStorage.getItem(RADIO_STATE_KEY) !== '1') return;
            if (!audio.paused) return; // ya está sonando
            isPlaying = true;
            clearReconnect();
            const p = audio.play();
            if (p && p.catch) {
                p.catch(function () { scheduleReconnect(); });
            }
            syncPlayState();
        } catch (e) { }
    }

    // Al volver a esta pestaña (atrás del teléfono, cambio de pestaña, etc.)
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            resumeRadioIfPaused();
            // Si se estaba viendo la transmisión de Master Crazy TV (OK.ru),
            // reconectar: los navegadores congelan el iframe en segundo plano
            const modal = document.getElementById('tv-modal');
            if (modal && modal.style.display === 'flex' && tvIsPartido) {
                reloadTvIframe();
            }
        }
    });
    window.addEventListener('pageshow', resumeRadioIfPaused);

    // ===== Radio optimizada: pantalla apagada, redes lentas y reconexion =====
    // 1) Media Session: con la pantalla apagada el sistema mantiene el audio
    //    vivo y muestra los controles en la pantalla de bloqueo.
    // 2) Vigilante permanente: si el sistema lo suspende o la red se cae
    //    (2G / 3G / H+ o cambio Wi-Fi <-> datos) vuelve a conectar solo.
    // 3) Nunca se queda en silencio: insiste indefinidamente y recarga la
    //    conexion tras varios fallos seguidos.
    (function initRadioOptimizations() {
        try { audio.preload = 'auto'; } catch (e) { }

        let fallosSeguidos = 0;

        function pausar() {
            isPlaying = false;
            audio.pause();
            syncPlayState();
            persistPlayState();
        }

        function reanudar() {
            isPlaying = true;
            clearReconnect();
            const p = audio.play();
            if (p && p.catch) p.catch(function () { scheduleReconnect(); });
            syncPlayState();
            persistPlayState();
        }

        function reconectar(forzarRecarga) {
            if (!isPlaying) return;
            if (radioPausedForVideo || radioPausedForTop5) return;
            clearReconnect();
            if (forzarRecarga) {
                try { audio.load(); } catch (e) { }
            }
            const p = audio.play();
            if (p && p.catch) {
                p.catch(function () {
                    fallosSeguidos++;
                    if (fallosSeguidos >= 3) {
                        fallosSeguidos = 0;
                        try { audio.load(); } catch (e) { }
                    }
                    scheduleReconnect();
                });
            } else {
                fallosSeguidos = 0;
            }
        }

        // --- Media Session (controles con la pantalla apagada) ---
        try {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: 'Master Crazy Radio',
                    artist: 'Radio Colombia Numero Uno en Cumbia',
                    album: 'Master Crazy Radio',
                    artwork: [
                        { src: 'logo_circular.jpg', sizes: '1024x1024', type: 'image/jpeg' }
                    ]
                });
                navigator.mediaSession.setActionHandler('play', function () { reanudar(); });
                navigator.mediaSession.setActionHandler('pause', function () { pausar(); });
                navigator.mediaSession.setActionHandler('stop', function () { pausar(); });
            }
        } catch (e) { }

        audio.addEventListener('playing', function () {
            fallosSeguidos = 0;
            try {
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
            } catch (e) { }
        });
        audio.addEventListener('play', function () {
            try {
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
            } catch (e) { }
        });
        audio.addEventListener('pause', function () {
            try {
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
            } catch (e) { }
            // Si el sistema la pauso por su cuenta, se retoma sola
            if (isPlaying && !radioPausedForVideo && !radioPausedForTop5) {
                setTimeout(function () { reconectar(false); }, 1200);
            }
        });

        // --- Cortes tipicos de red en 2G / 3G / H+ ---
        ['error', 'stalled', 'ended'].forEach(function (ev) {
            audio.addEventListener(ev, function () {
                if (isPlaying && !radioPausedForVideo && !radioPausedForTop5) {
                    setTimeout(function () { reconectar(true); }, 800);
                }
            });
        });

        // --- Vigilante permanente: la radio nunca se queda muda ---
        setInterval(function () {
            if (!isPlaying) return;
            if (radioPausedForVideo || radioPausedForTop5) return;
            if (audio.paused || audio.readyState === 0) {
                reconectar(audio.readyState === 0);
            }
        }, 10000);

        // --- Cambio de red (Wi-Fi <-> datos) o vuelta de la conexion ---
        try {
            if (navigator.connection && navigator.connection.addEventListener) {
                navigator.connection.addEventListener('change', function () {
                    if (isPlaying) setTimeout(function () { reconectar(true); }, 1200);
                });
            }
        } catch (e) { }
        window.addEventListener('online', function () {
            if (isPlaying) setTimeout(function () { reconectar(true); }, 800);
        });
    })();

    // ===== Arranque automatico al entrar a la web =====
    // Se intenta reproducir de inmediato (y con la conexion ya pre-abierta por
    // el preconnect, arranca en el primer segundo). Los navegadores NO permiten
    // sonar sin un toque previo del usuario, asi que si lo bloquean, la radio
    // arranca con el PRIMER toque, scroll o tecla en cualquier parte.
    (function autoArranqueRadio() {
        let arrancado = false;

        function marcarAtencion(activo) {
            try {
                const b1 = document.getElementById('play-btn');
                const b2 = document.getElementById('header-play-btn');
                [b1, b2].forEach(function (b) {
                    if (!b) return;
                    if (activo) b.classList.add('pulse-attention');
                    else b.classList.remove('pulse-attention');
                });
            } catch (e) { }
        }

        function quitarEscuchas() {
            ['touchstart', 'click', 'keydown', 'scroll', 'pointerdown'].forEach(function (ev) {
                document.removeEventListener(ev, intentar, true);
            });
        }

        function intentar() {
            if (arrancado) return;
            if (isPlaying) { arrancado = true; quitarEscuchas(); marcarAtencion(false); return; }
            const p = audio.play();
            if (p && p.then) {
                p.then(function () {
                    arrancado = true;
                    isPlaying = true;
                    syncPlayState();
                    persistPlayState();
                    marcarAtencion(false);
                    quitarEscuchas();
                }).catch(function () {
                    // Bloqueado por el navegador: esperamos al primer toque
                    marcarAtencion(true);
                });
            } else {
                arrancado = true;
                isPlaying = true;
                syncPlayState();
                marcarAtencion(false);
                quitarEscuchas();
            }
        }

        // Intento inmediato al cargar
        intentar();
        // Y en el primer gesto del usuario, en cualquier parte de la pagina
        ['touchstart', 'click', 'keydown', 'scroll', 'pointerdown'].forEach(function (ev) {
            document.addEventListener(ev, intentar, true);
        });
        // Reintentos cortos por si el navegador concede el permiso despues
        setTimeout(intentar, 600);
        setTimeout(intentar, 1800);
    })();

    // === Auto-reconexión: si la conexión se pierde o se vuelve inestable,
    // el reproductor se reconecta solo para que el oyente nunca quede sin música. ===
    function showReconnectStatus(show) {
        const el = document.getElementById('reconnect-status');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    function clearReconnect() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        showReconnectStatus(false);
    }

    function scheduleReconnect() {
        if (!isPlaying || connectionLost) return;
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
        reconnectAttempts++;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        showReconnectStatus(true);
        reconnectTimer = setTimeout(tryReconnect, delay);
    }

    function tryReconnect() {
        reconnectTimer = null;
        if (!isPlaying) return;
        showReconnectStatus(true);
        try {
            audio.load();
            const p = audio.play();
            if (p && p.catch) {
                p.catch(function () { scheduleReconnect(); });
            }
        } catch (e) {
            scheduleReconnect();
        }
    }

    function togglePlay() {
        if (isPlaying) {
            audio.pause();
            isPlaying = false;
            clearReconnect();
        } else {
            isPlaying = true;
            clearReconnect();
            // IMPORTANTE: el audio normal NO pasa por Web Audio. El refuerzo
            // Super Bass usa un elemento oculto aparte; la radio suena directa.
            audio.play().catch(error => {
                console.error("Playback failed:", error);
                // Prioridad: reconectarse automáticamente en vez de solo alertar
                scheduleReconnect();
            });
        }
        persistPlayState();
        syncPlayState();
    }

    // Eventos del stream: reconectar ante fallos o inestabilidad
    audio.addEventListener('error', function () { if (isPlaying) scheduleReconnect(); });
    audio.addEventListener('stalled', function () { if (isPlaying) scheduleReconnect(); });
    audio.addEventListener('waiting', function () { if (isPlaying) showReconnectStatus(true); });
    audio.addEventListener('ended', function () { if (isPlaying) scheduleReconnect(); });
    audio.addEventListener('playing', function () {
        reconnectAttempts = 0;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        showReconnectStatus(false);
    });

    // Conexión del navegador: al caer la red, avisar; al volver, reconectar ya
    window.addEventListener('offline', function () {
        connectionLost = true;
        if (isPlaying) showReconnectStatus(true);
    });
    window.addEventListener('online', function () {
        connectionLost = false;
        if (isPlaying) tryReconnect();
    });

    // Play/Pause
    playBtn.addEventListener('click', togglePlay);
    if (headerPlayBtn) {
        headerPlayBtn.addEventListener('click', togglePlay);
    }
    // Al tocar el logo de la radio, la radio comienza a sonar
    // con efecto punch (entra y sale como botón físico)
    if (heroLogo) {
        heroLogo.addEventListener('click', function () {
            heroLogo.classList.remove('logo-punch');
            void heroLogo.offsetWidth; // reinicia la animación
            heroLogo.classList.add('logo-punch');
            togglePlay();
        });
    }

    // Si la radio estaba sonando al salir de la página (noticia, enlace externo),
    // se reanuda automáticamente al volver (incluye recargas tras "atrás").
    resumeRadioIfPaused();

    // Video de noticias deportivas: al reproducirse pausa la radio y al
    // pausarse o terminar, la radio vuelve a sonar.
    const newsVideo = document.querySelector('.news-video');
    if (newsVideo) {
        newsVideo.addEventListener('play', function () {
            if (isPlaying) {
                radioPausedForVideo = true;
                togglePlay();
            } else {
                radioPausedForVideo = false;
            }
        });
        newsVideo.addEventListener('pause', function () {
            if (radioPausedForVideo) {
                radioPausedForVideo = false;
                togglePlay();
            }
        });
        newsVideo.addEventListener('ended', function () {
            if (radioPausedForVideo) {
                radioPausedForVideo = false;
                togglePlay();
            }
        });
    }

    // Volume Control
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        audio.volume = volume;

        // Update icon based on volume
        if (volume == 0) {
            volumeIcon.className = 'fas fa-volume-mute';
        } else if (volume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down';
        } else {
            volumeIcon.className = 'fas fa-volume-up';
        }
    });

    // Metadata Fetching using Zeno API (SSE)
    function initMetadata() {
        const mountKey = 'zadzh811p48uv'; // Extracted from stream URL
        const metadataUrl = `https://api.zeno.fm/mounts/metadata/subscribe/${mountKey}`;

        const eventSource = new EventSource(metadataUrl);

        eventSource.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);
                let titleText = '';
                if (data.streamTitle) {
                    titleText = data.streamTitle;
                } else if (data.artist && data.title) {
                    titleText = `${data.artist} - ${data.title}`;
                }
                if (titleText) {
                    songTitleElement.innerText = titleText;
                }
            } catch (e) {
                console.error("Error parsing metadata:", e);
            }
        };

        eventSource.onerror = function (err) {
            console.error("Metadata connection error:", err);
            // Fallback text if API fails
            // songTitleElement.innerText = "MASTER CRAZY RADIO - LA CASA OFICIAL DE LA CUMBIA";
            eventSource.close();
            // Try to reconnect after 10 seconds
            setTimeout(initMetadata, 10000);
        };
    }

    // Initialize Metadata
    initMetadata();

    // Spotlight Effect (se omite en modo bajo consumo: consume GPU/CPU)
    const spotlight = document.querySelector('.spotlight');
    if (!lowPowerMode) {
        document.addEventListener('mousemove', (e) => {
            spotlight.style.left = e.clientX + 'px';
            spotlight.style.top = e.clientY + 'px';
        });
    }

    // 3D Tilt Effect for Player (se omite en modo bajo consumo)
    const card = document.getElementById('tilt-card');
    const wrapper = document.querySelector('.player-wrapper');

    if (!lowPowerMode) {
        wrapper.addEventListener('mousemove', (e) => {
            const rect = wrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg rotation
            const rotateY = ((x - centerX) / centerX) * 10;

            card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
        });

        wrapper.addEventListener('mouseleave', () => {
            card.style.transform = 'rotateX(0) rotateY(0) scale(1)';
        });
    }

    // Smooth scroll: la opción TV del header lleva directo a la tarjeta
    // MASTER CRAZY TV (centrada y con resaltado para que se ubique al instante)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = this.getAttribute('href');
            if (target === '#tv-section') {
                const mctv = document.getElementById('master-crazy-tv-card');
                if (mctv) {
                    mctv.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Resaltar brevemente la tarjeta para que se vea
                    mctv.classList.remove('tv-card-flash');
                    void mctv.offsetWidth; // reinicia la animación
                    mctv.classList.add('tv-card-flash');
                    setTimeout(function () { mctv.classList.remove('tv-card-flash'); }, 2200);
                    return;
                }
            }
            const el = document.querySelector(target);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // Flyer Slider
    const flyerSlider = document.getElementById('flyer-slider');
    const flyerTrack = document.getElementById('flyer-slider-track');
    const flyerSlides = flyerTrack ? flyerTrack.querySelectorAll('.flyer-slide') : [];
    const flyerPrev = document.getElementById('flyer-slider-prev');
    const flyerNext = document.getElementById('flyer-slider-next');
    const flyerDotsWrap = document.getElementById('flyer-slider-dots');
    let flyerIndex = 0;
    let flyerTimer = null;
    const FLYER_INTERVAL = 5000;

    if (flyerTrack && flyerSlides.length > 1) {
        // Build dots
        flyerSlides.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.className = 'flyer-slider-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', 'Ir al flyer ' + (i + 1));
            dot.addEventListener('click', () => goToFlyer(i));
            flyerDotsWrap.appendChild(dot);
        });
        const flyerDots = flyerDotsWrap.querySelectorAll('.flyer-slider-dot');

        function goToFlyer(index) {
            flyerIndex = (index + flyerSlides.length) % flyerSlides.length;
            flyerTrack.style.transform = `translateX(-${flyerIndex * 100}%)`;
            flyerDots.forEach((d, i) => d.classList.toggle('active', i === flyerIndex));
            flyerSlides.forEach((s, i) => {
                const card = s.querySelector('.flyer-slide-card');
                if (card) card.classList.toggle('active', i === flyerIndex);
            });
        }

        function nextFlyer() { goToFlyer(flyerIndex + 1); restartFlyerTimer(); }
        function prevFlyer() { goToFlyer(flyerIndex - 1); restartFlyerTimer(); }

        function restartFlyerTimer() {
            clearInterval(flyerTimer);
            flyerTimer = setInterval(() => goToFlyer(flyerIndex + 1), FLYER_INTERVAL);
        }

        flyerNext.addEventListener('click', nextFlyer);
        flyerPrev.addEventListener('click', prevFlyer);
        flyerSlider.addEventListener('mouseenter', () => clearInterval(flyerTimer));
        flyerSlider.addEventListener('mouseleave', restartFlyerTimer);

        // Swipe support (touch)
        let touchStartX = 0;
        flyerSlider.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        }, { passive: true });
        flyerSlider.addEventListener('touchend', (e) => {
            const diff = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(diff) > 50) {
                diff < 0 ? nextFlyer() : prevFlyer();
            }
        }, { passive: true });

        restartFlyerTimer();
    }

    // Flyer 3D Tilt Effect (applies to active slide) - se omite en modo bajo consumo
    const flyerWrapper = document.querySelector('.flyer-wrapper');

    if (flyerWrapper && !lowPowerMode) {
        const tiltable = flyerWrapper.querySelector('.flyer-slide-card');
        if (tiltable) {
            flyerWrapper.addEventListener('mousemove', (e) => {
                const activeCard = flyerWrapper.querySelector('.flyer-slide-card.active');
                if (!activeCard) return;
                const rect = flyerWrapper.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                const rotateX = ((y - centerY) / centerY) * -8;
                const rotateY = ((x - centerX) / centerX) * 8;

                activeCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
            });

            flyerWrapper.addEventListener('mouseleave', () => {
                const activeCard = flyerWrapper.querySelector('.flyer-slide-card.active');
                if (activeCard) activeCard.style.transform = 'rotateX(0) rotateY(0) scale(1)';
            });
        }
    }

    console.log("Master Crazy Radio - Custom Player with Live Metadata Loaded!");

    // Live TV Logic
    window.playChannel = function (channelId, streamUrl) {
        const modal = document.getElementById('tv-modal');
        const video = document.getElementById('tv-player');
        const iframeContainer = document.getElementById('tv-iframe-container');
        const title = document.getElementById('channel-name');

        // Si había un iframe del partido, ocultarlo y limpiarlo
        if (iframeContainer) {
            iframeContainer.style.display = 'none';
            const iframe = document.getElementById('tv-iframe');
            if (iframe) iframe.src = '';
        }
        tvIsPartido = false;
        stopTvWatchdog();
        if (video) video.style.display = '';

        // Pausar la radio mientras se ve TV (se reanuda sola al cerrar el modal)
        if (isPlaying) {
            radioWasPlayingBeforeTv = true;
            togglePlay();
        } else {
            radioWasPlayingBeforeTv = false;
        }

        openTvModal(modal);
        modal.classList.remove('partido-mode');
        // Pantalla completa nativa en cualquier dispositivo
        requestFullscreenVertical(modal);
        title.innerHTML = channelId.toUpperCase() + " TV <br><span style='font-size:0.8rem; color:#aaa;'>Cargando stream...</span>";

        const handleStreamError = () => {
            console.error("Stream failed to load:", streamUrl);
            let officialUrl = '#';
            if (channelId === 'redplus') officialUrl = 'https://www.canalredmas.com/';
            if (channelId === 'cablenoticias') officialUrl = 'https://www.cablenoticias.tv/';
            if (channelId === 'lakalle') officialUrl = 'https://www.canalrcn.com/canales/la-kalle';
            if (channelId === 'mci') officialUrl = 'https://www.mcitv.com.co/';
            if (channelId === 'trece') officialUrl = 'https://canaltrece.com.co/senal-en-vivo/';
            if (channelId === 'teleantioquia') officialUrl = 'https://www.teleantioquia.co/en-vivo/';

            title.innerHTML = channelId.toUpperCase() + " TV <br><span style='font-size:0.8rem; color:#ff4444;'>Stream no disponible. <a href='" + officialUrl + "' target='_blank' style='color:#fff; text-decoration:underline;'>Ver en sitio oficial</a></span>";
        };

        if (Hls.isSupported()) {
            if (window.hls) {
                window.hls.destroy();
            }
            const hls = new Hls();
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                // Reproducción compatible con móvil: iOS bloquea play() con sonido
                // en callbacks asíncronos, así que iniciamos en silencio y desmutearnos
                // cuando el video realmente esté sonando.
                video.muted = true;
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        video.muted = false;
                        title.innerText = channelId.toUpperCase() + " TV";
                    }).catch(() => {
                        title.innerText = channelId.toUpperCase() + " TV";
                    });
                } else {
                    title.innerText = channelId.toUpperCase() + " TV";
                }
            });
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    handleStreamError();
                }
            });
            window.hls = hls;
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', function () {
                video.muted = true;
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        video.muted = false;
                        title.innerText = channelId.toUpperCase() + " TV";
                    }).catch(() => {
                        title.innerText = channelId.toUpperCase() + " TV";
                    });
                } else {
                    title.innerText = channelId.toUpperCase() + " TV";
                }
            });
            video.addEventListener('error', handleStreamError);
        }
    };

    // Pantalla completa nativa (teléfonos). Al tocar la tarjeta, el modal
    // entra en fullscreen real (oculta la barra del navegador). La orientación
    // queda LIBRE: si el usuario voltea el teléfono, la transmisión ocupa toda
    // la pantalla en horizontal (ver listeners de orientación abajo).
    // --- Diagnostico en pantalla (para leer el estado desde una captura) ---
    const APP_VERSION = 'v15';
    function tvDebug(extra) {
        // Diagnostico en pantalla retirado a pedido del Ser Superior.
    }
    window.tvDebug = tvDebug;

    function requestFullscreenVertical(el) {
        try {
            const target = el || document.documentElement;
            let p = null;
            if (target.requestFullscreen) {
                p = target.requestFullscreen();
            } else if (target.webkitRequestFullscreen) {
                p = target.webkitRequestFullscreen();
            } else if (target.msRequestFullscreen) {
                p = target.msRequestFullscreen();
            }
            if (p && p.then) {
                p.then(function () { tvDebug('FS ok'); })
                    .catch(function (err) { tvDebug('FS NO: ' + (err && err.name ? err.name : 'error')); });
            } else {
                tvDebug(p ? 'FS ok' : 'FS NO: sin API');
            }
        } catch (e) { }
        // No bloquear la orientación: permite girar el teléfono (giroscopio)
        // para que el video llene toda la pantalla en horizontal.
        try {
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        } catch (e) { }
    }

    // Giro del teléfono: al voltear a horizontal (landscape) mientras se ve un
    // canal de TV, la transmisión se expande a toda la pantalla.
    function updateTvOrientationClass() {
        if (isTvDevice()) return; // en TV la orientación es fija (horizontal)
        const modal = document.getElementById('tv-modal');
        if (!modal || modal.style.display !== 'flex') return;
        const landscape = window.innerWidth > window.innerHeight;
        modal.classList.toggle('is-landscape', landscape);
        // La pantalla completa se mantiene en CUALQUIER orientación: vertical u
        // horizontal se comportan igual. Si se perdió (p. ej. al girar), se
        // vuelve a pedir.
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            requestFullscreenVertical(document.documentElement);
        }
    }

    // Botón "Ampliar pantalla": pantalla completa + modo horizontal (landscape)
    window.expandTvFullscreen = function () {
        const modal = document.getElementById('tv-modal');
        if (!modal || modal.style.display !== 'flex') return;
        // Forzar orientación horizontal (solo funciona en fullscreen, Android/Chrome)
        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(function () { });
            }
        } catch (e) { }
        // Marcar modo horizontal y entrar en fullscreen nativo
        modal.classList.add('is-landscape');
        try {
            if (modal.requestFullscreen) {
                modal.requestFullscreen().catch(function () { });
            } else if (modal.webkitRequestFullscreen) {
                modal.webkitRequestFullscreen();
            } else if (modal.msRequestFullscreen) {
                modal.msRequestFullscreen();
            }
        } catch (e) { }
    };

    window.addEventListener('orientationchange', function () {
        setTimeout(updateTvOrientationClass, 350);
    });
    window.addEventListener('resize', function () {
        setTimeout(updateTvOrientationClass, 250);
    });

    // Giroscopio (deviceorientation) con permiso en iOS: refuerzo de la detección
    function enableGyroOrientation() {
        if (isTvDevice()) return; // giroscopio solo aplica a teléfonos
        try {
            window.addEventListener('deviceorientation', function () {
                updateTvOrientationClass();
            });
        } catch (e) { }
    }
    try {
        if (!isTvDevice() && typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS pide permiso con un gesto del usuario
            document.addEventListener('click', function once() {
                DeviceOrientationEvent.requestPermission()
                    .then(function (state) {
                        if (state === 'granted') enableGyroOrientation();
                    })
                    .catch(function () { });
                document.removeEventListener('click', once);
            });
        } else {
            enableGyroOrientation();
        }
    } catch (e) { }

    function exitFullscreen() {
        try {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            else if (document.msExitFullscreen) document.msExitFullscreen();
        } catch (e) { }
        try {
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        } catch (e) { }
    }

    function isMobileDevice() {
        return document.documentElement.classList.contains('is-mobile');
    }

    function isTvDevice() {
        return document.documentElement.classList.contains('is-tv');
    }

    // Navegación: el botón "atrás" del teléfono cierra el reproductor
    // y vuelve a la página de inicio en vez de dejar pantalla negra.
    let tvModalHistoryPushed = false;
    // Momento en que se abrio el modal: evita que un fallo al pedir pantalla
    // completa cierre la transmision al instante (rebote a la pagina principal).
    let tvOpenedAtMs = 0;
    // La radio se pausa al abrir la TV y se reanuda sola al cerrarla
    let radioWasPlayingBeforeTv = false;

    function openTvModal(modal) {
        modal.style.display = 'flex';
        // Modo rendimiento: se apagan las animaciones pesadas de la página
        // mientras se ve TV para que el video no se congele (TV boxes, gama baja)
        document.body.classList.add('tv-open');
        // En TV (ONN Watch, Fire TV, Smart TV, Android TV): entrar directo a
        // fullscreen nativo para que el video estirado ocupe el 100% real de la
        // pantalla (oculta la barra del navegador). El CSS .is-tv ya llena 100vw/100vh.
        if (isTvDevice()) {
            try {
                if (typeof window.expandTvFullscreen === 'function') {
                    window.expandTvFullscreen();
                } else {
                    const el = modal;
                    if (el.requestFullscreen) { el.requestFullscreen().catch(function () { }); }
                    else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); }
                }
            } catch (e) { }
        }
        if (!tvModalHistoryPushed) {
            tvModalHistoryPushed = true;
            try { history.pushState({ tvModal: true }, ''); } catch (e) { }
        }
        tvOpenedAtMs = Date.now();
    }

    // ===== Mini reproductor (estilo DGO / Disney+) =====
    // Al pulsar ATRAS la transmision se hace pequena y SIGUE reproduciendo.
    // Un toque sobre el mini la devuelve a pantalla completa.
    function enterMiniTv() {
        const modal = document.getElementById('tv-modal');
        if (!modal) return;
        exitFullscreen();
        modal.classList.remove('deep-link-mode');
        modal.classList.remove('forced-landscape');
        modal.classList.add('tv-mini');
        document.body.classList.remove('tv-open');
    }
    function exitMiniTv() {
        const modal = document.getElementById('tv-modal');
        if (!modal) return;
        modal.classList.remove('tv-mini');
        document.body.classList.add('tv-open');
        modal.classList.add('deep-link-mode');
        if (typeof applyTvFitMode === 'function') applyTvFitMode();
        requestFullscreenVertical(document.documentElement);
    }
    window.enterMiniTv = enterMiniTv;
    window.exitMiniTv = exitMiniTv;

    // Al pulsar ATRAS: primero se hace mini (y sigue sonando); otro ATRAS cierra.
    window.addEventListener('popstate', function () {
        const modal = document.getElementById('tv-modal');
        if (!modal || modal.style.display !== 'flex') return;
        if (!modal.classList.contains('tv-mini')) {
            enterMiniTv();
        } else {
            closeTvModal();
        }
        tvModalHistoryPushed = true;
        try { history.pushState({ tvModal: true }, ''); } catch (e) { }
    });

    // Si el usuario sale del fullscreen nativo (gesto o atrás en Android),
    // cerrar el modal para no dejar pantalla negra
    document.addEventListener('fullscreenchange', function () {
        const modal = document.getElementById('tv-modal');
        if (!modal || modal.style.display !== 'flex') return;
        // Margen de gracia: si el equipo rechaza o sale de pantalla completa
        // JUSTO al abrir, no se cierra la transmision (evita el rebote).
        if (Date.now() - tvOpenedAtMs < 2500) return;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            closeTvModal();
        }
    });

    // === Auto-reconexión de la transmisión de Master Crazy TV (iframe de OK.ru) ===
    // El iframe es cross-origin y OK.ru no expone eventos de pausa/error al padre,
    // así que un vigilante recarga el embed cuando la transmisión se detiene/congela:
    //  - recarga periódica MUY espaciada (30 min) como red de seguridad: el stream de
    //    OBS ya se auto-reconecta solo, así que recargas frecuentes solo causan
    //    micro-pausas visibles en la página,
    //  - recarga al volver a la pestaña (los navegadores congelan el iframe),
    //  - recarga si el embed no termina de cargar en 45s.
    const TV_PARTIDO_EMBED = '//ok.ru/videoembed/13981676805705?autoplay=1&nochat=1';
    const TV_WATCHDOG_MS = 15000;
    const TV_RELOAD_INTERVAL_MS = 1800000; // 30 min: red de seguridad sin pausas molestas
    const TV_LOAD_TIMEOUT_MS = 45000;
    let tvWatchdogTimer = null;
    let tvIframeLoadTimer = null;
    let tvLastReload = 0;
    let tvIsPartido = false;

    // === Cortina con el logo mientras conecta / reconecta ===
    let tvReconnectTimer = null;
    let tvCurtainTimer = null;
    const TV_CURTAIN_AFTER_LOAD_MS = 4000;  // se mantiene tras cargar el embed
    const TV_CURTAIN_MAX_MS = 15000;        // tope si el embed nunca carga

    function setReconnectNumber(text, isGo) {
        const countEl = document.getElementById('tv-reconnect-count');
        if (!countEl) return;
        countEl.textContent = text;
        countEl.classList.toggle('go', !!isGo);
        // Reiniciar la animación pop en cada número
        countEl.style.animation = 'none';
        void countEl.offsetWidth;
        countEl.style.animation = 'reconnectPop 0.6s ease-in-out';
    }

    // Cortina con el logo: se muestra ANTES de que arranque la transmision y
    // mientras OK.ru se esta reconectando. Tapa por completo la imagen previa
    // que trae el embed (el partido de futbol) para que nunca se vea.
    function showReconnectCountdown() {
        const overlay = document.getElementById('tv-reconnect-overlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        if (tvReconnectTimer) { clearInterval(tvReconnectTimer); tvReconnectTimer = null; }
    }

    function hideReconnectCountdown() {
        const overlay = document.getElementById('tv-reconnect-overlay');
        if (overlay) overlay.style.display = 'none';
        if (tvReconnectTimer) { clearInterval(tvReconnectTimer); tvReconnectTimer = null; }
    }

    function reloadTvIframe() {
        const iframe = document.getElementById('tv-iframe');
        const modal = document.getElementById('tv-modal');
        if (!iframe || !tvIsPartido) return;
        if (!modal || modal.style.display !== 'flex') return;
        const now = Date.now();
        if (now - tvLastReload < 10000) return; // anti-bucle
        tvLastReload = now;
        // Aviso en pantalla: conteo 3-2-1 GO mientras reconecta
        showReconnectCountdown();
        // Recarga real del embed (vaciar y volver a poner la URL)
        iframe.src = '';
        iframe.src = TV_PARTIDO_EMBED;
        armTvLoadWatchdog();
    }

    function armTvLoadWatchdog() {
        if (tvIframeLoadTimer) clearTimeout(tvIframeLoadTimer);
        tvIframeLoadTimer = setTimeout(function () {
            tvIframeLoadTimer = null;
            // El embed no cargó a tiempo: reintentar la reconexión
            reloadTvIframe();
        }, TV_LOAD_TIMEOUT_MS);
    }

    function startTvWatchdog() {
        stopTvWatchdog();
        tvLastReload = Date.now();
        tvWatchdogTimer = setInterval(function () {
            const modal = document.getElementById('tv-modal');
            if (!modal || modal.style.display !== 'flex' || !tvIsPartido) return;
            if (document.hidden) return; // pestaña en segundo plano: no recargar
            if (Date.now() - tvLastReload >= TV_RELOAD_INTERVAL_MS) {
                reloadTvIframe();
            }
        }, TV_WATCHDOG_MS);
    }

    function stopTvWatchdog() {
        if (tvWatchdogTimer) { clearInterval(tvWatchdogTimer); tvWatchdogTimer = null; }
        if (tvIframeLoadTimer) { clearTimeout(tvIframeLoadTimer); tvIframeLoadTimer = null; }
    }

    // Al terminar de cargar el embed, se desarma el vigilante de carga
    // y se oculta el aviso de reconexión
    const tvIframeEl = document.getElementById('tv-iframe');
    if (tvIframeEl) {
        tvIframeEl.addEventListener('load', function () {
            if (tvIframeLoadTimer) { clearTimeout(tvIframeLoadTimer); tvIframeLoadTimer = null; }
            // La cortina con el logo sigue unos segundos mas: el embed carga su
            // pagina antes de que el video arranque (asi no se ve el partido).
            if (tvCurtainTimer) clearTimeout(tvCurtainTimer);
            tvCurtainTimer = setTimeout(hideReconnectCountdown, TV_CURTAIN_AFTER_LOAD_MS);
        });
    }

    // Partido En Vivo (iframe ok.ru)
    window.playPartido = function () {
        const modal = document.getElementById('tv-modal');
        const video = document.getElementById('tv-player');
        const iframeContainer = document.getElementById('tv-iframe-container');
        const iframe = document.getElementById('tv-iframe');
        const title = document.getElementById('channel-name');

        // Cortina con el logo desde el inicio: tapa la imagen previa del embed
        // de OK.ru mientras la transmision arranca.
        showReconnectCountdown();
        if (tvCurtainTimer) clearTimeout(tvCurtainTimer);
        tvCurtainTimer = setTimeout(hideReconnectCountdown, TV_CURTAIN_MAX_MS);

        // Detener HLS/video anterior si estaba activo
        if (window.hls) {
            window.hls.destroy();
            window.hls = null;
        }
        if (video) {
            video.pause();
            video.src = '';
            video.style.display = 'none';
        }

        // Pausar la radio mientras se ve TV (se reanuda sola al cerrar el modal)
        if (isPlaying) {
            radioWasPlayingBeforeTv = true;
            togglePlay();
        } else {
            radioWasPlayingBeforeTv = false;
        }

        // Mostrar el iframe del partido en el modal (autoplay=1 para arrancar solo en móvil)
        if (iframeContainer) iframeContainer.style.display = 'block';
        if (iframe) {
            tvIsPartido = true;
            iframe.src = TV_PARTIDO_EMBED;
            armTvLoadWatchdog();
            startTvWatchdog();
        }
        openTvModal(modal);
        modal.classList.add('partido-mode'); // sin título flotante dentro de la transmisión
        // Pantalla completa en TODOS los dispositivos (moviles, TV boxes, Smart TV
        // y autoradios Android): el modal ocupa todo el viewport y la imagen se
        // ajusta SIN recortar, aunque la API Fullscreen no exista en el equipo.
        modal.classList.add('deep-link-mode');
        applyTvFitMode();
        title.innerHTML = "Master Crazy <span style='color:#7DF9FF;'>TV</span>";

        // Pantalla completa nativa en cualquier dispositivo
        requestFullscreenVertical(modal);
    };

    // Caracol TV (señal oficial YouTube - embed legal)
    window.playCaracol = function () {
        const modal = document.getElementById('tv-modal');
        const video = document.getElementById('tv-player');
        const iframeContainer = document.getElementById('tv-iframe-container');
        const iframe = document.getElementById('tv-iframe');
        const title = document.getElementById('channel-name');

        // Detener HLS/video anterior si estaba activo
        if (window.hls) {
            window.hls.destroy();
            window.hls = null;
        }
        if (video) {
            video.pause();
            video.src = '';
            video.style.display = 'none';
        }

        // Pausar la radio mientras se ve TV (se reanuda sola al cerrar el modal)
        if (isPlaying) {
            radioWasPlayingBeforeTv = true;
            togglePlay();
        } else {
            radioWasPlayingBeforeTv = false;
        }

        // Cargar la señal en vivo oficial de Caracol TV (YouTube embed)
        tvIsPartido = false; // el watchdog de reconexión es solo para la transmisión de OK.ru
        stopTvWatchdog();
        if (iframeContainer) iframeContainer.style.display = 'block';
        if (iframe) iframe.src = 'https://www.youtube.com/embed/x0eOenDDelg?autoplay=1&rel=0';
        openTvModal(modal);
        modal.classList.remove('partido-mode');
        title.innerHTML = "Caracol <span style='color:#7DF9FF;'>TV</span> <br><span style='font-size:0.8rem; color:#aaa;'>Señal en vivo</span>";

        // Pantalla completa nativa en cualquier dispositivo
        requestFullscreenVertical(modal);
    };

    window.closeTvModal = function () {
        const modal = document.getElementById('tv-modal');
        const video = document.getElementById('tv-player');
        const iframeContainer = document.getElementById('tv-iframe-container');
        const iframe = document.getElementById('tv-iframe');

        video.pause();
        video.src = "";
        if (window.hls) {
            window.hls.destroy();
        }
        // Limpiar iframe del partido
        if (iframeContainer) iframeContainer.style.display = 'none';
        if (iframe) iframe.src = '';
        tvIsPartido = false;
        stopTvWatchdog();
        hideReconnectCountdown();

        modal.style.display = 'none';
        modal.classList.remove('partido-mode');
        modal.classList.remove('deep-link-mode');
        modal.classList.remove('forced-landscape');
        modal.classList.remove('tv-mini');
        tvModalHistoryPushed = false;
        // Se reactivan las animaciones de la página
        document.body.classList.remove('tv-open');

        // Salir de pantalla completa nativa y desbloquear orientación
        exitFullscreen();

        // Al cerrar la TV (atrás, X o clic fuera), la radio vuelve a sonar
        if (radioWasPlayingBeforeTv) {
            radioWasPlayingBeforeTv = false;
            togglePlay();
        }
    };

    // Close modal on click outside
    window.onclick = function (event) {
        const modal = document.getElementById('tv-modal');
        if (event.target == modal) {
            closeTvModal();
        }
    };

    // Vigilancia del estado del Partido En Vivo (status.json lo actualiza el bot)
    // Si la transmisión de OK.ru está en pausa/caída, la tarjeta muestra el mensaje.
    // IMPORTANTE: solo muestra "EN PAUSA" si status.json es RECIENTE (el bot lo
    // actualiza) y dice offline. Si el archivo está viejo o no existe, se asume
    // que la transmisión está EN VIVO (evita avisos falsos de pausa).
    function refreshPartidoStatus() {
        fetch('status.json?ts=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                const badge = document.getElementById('partido-badge');
                const statusMsg = document.getElementById('partido-status');
                if (!badge) return;
                // ¿El archivo fue actualizado hace menos de 30 minutos?
                let esReciente = false;
                if (data && data.updatedAt) {
                    const edad = Date.now() - new Date(data.updatedAt).getTime();
                    esReciente = edad < 30 * 60 * 1000;
                }
                if (data && data.status === 'ONLINE') {
                    badge.textContent = 'EN VIVO';
                    badge.classList.remove('offline');
                    if (statusMsg) statusMsg.style.display = 'none';
                } else if (esReciente) {
                    badge.textContent = 'EN PAUSA';
                    badge.classList.add('offline');
                    if (statusMsg) {
                        statusMsg.textContent = (data && data.message) ? data.message : 'Transmisión en pausa — vuelve en un momento';
                        statusMsg.style.display = 'block';
                    }
                } else {
                    // Archivo viejo o ausente: asumir que está al aire
                    badge.textContent = 'EN VIVO';
                    badge.classList.remove('offline');
                    if (statusMsg) statusMsg.style.display = 'none';
                }
            })
            .catch(function () { /* sin status.json: mantener EN VIVO por defecto */ });
    }

    refreshPartidoStatus();
    setInterval(refreshPartidoStatus, 45000);

    // Contact Form Handler
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();

            // Get form data
            const formData = {
                name: document.getElementById('name').value,
                email: document.getElementById('email').value,
                phone: document.getElementById('phone').value,
                message: document.getElementById('message').value
            };

            // Show success message
            alert('¡Gracias por tu mensaje! Nos pondremos en contacto contigo pronto.');

            // Reset form
            contactForm.reset();

            console.log('Form data:', formData);
        });
    }

    // === Estados de WhatsApp en el espacio de video de Noticias Deportivas ===
    // Nota: los estados personales de WhatsApp no se pueden incrustar en una web
    // (son privados, duran 24h y no tienen API pública). Lo que SÍ se incrusta de
    // forma oficial es un CANAL de WhatsApp: todo lo que publiques ahí (fotos,
    // videos, texto) aparece automáticamente en la web. Pega el enlace de tu canal:
    //   https://www.whatsapp.com/channel/<ID>
    const WHATSAPP_CHANNEL_URL = ''; // ej: 'https://www.whatsapp.com/channel/0029Va...'

    const whatsappWrap = document.getElementById('whatsapp-status-wrap');
    const whatsappEmbed = document.getElementById('whatsapp-status-embed');
    const newsVideoEl = document.querySelector('.news-video');
    if (whatsappWrap && whatsappEmbed && WHATSAPP_CHANNEL_URL) {
        whatsappEmbed.src = WHATSAPP_CHANNEL_URL.replace(/\/$/, '') + '/embed';
        whatsappWrap.style.display = 'block';
        if (newsVideoEl) newsVideoEl.style.display = 'none';
    }

    // Noticias Deportivas Section
    const newsGrid = document.getElementById('news-grid');
    if (newsGrid) {
        const NEWS_FEEDS = [
            { name: 'Marca Real Madrid', url: 'https://e00-marca.uecdn.es/rss/futbol/real-madrid.xml', keywords: [] },
            { name: 'Marca Barcelona', url: 'https://e00-marca.uecdn.es/rss/futbol/barcelona.xml', keywords: [] },
            { name: 'MD Real Madrid', url: 'https://www.mundodeportivo.com/rss/futbol/real-madrid.xml', keywords: [] },
            { name: 'MD Barcelona', url: 'https://www.mundodeportivo.com/rss/futbol/fc-barcelona.xml', keywords: [] }
        ];

        function getItemImage(item) {
            return (item.enclosure && item.enclosure.link) || item.thumbnail || item.image || '';
        }

        // Cargar noticias desde news.json (generado por el vigilante diario de
        // noticias deportivas: Real Madrid y Barcelona, primera division masculina)
        // y, si no existe, desde los feeds RSS.
        async function loadNews() {
            newsGrid.innerHTML = '<p class="news-loading">Cargando noticias deportivas...</p>';
            try {
                const res = await fetch('news.json?ts=' + Date.now(), { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        renderNews(data.map(item => ({ ...item, source: item.source || 'Deportes' })));
                        return;
                    }
                }
            } catch (e) {
                console.error('news.json no disponible, usando feeds RSS:', e);
            }

            // Fallback: feeds RSS en vivo
            const results = await Promise.all(NEWS_FEEDS.map(async (feed) => {
                try {
                    const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feed.url));
                    if (!response.ok) throw new Error('API error');
                    const data = await response.json();
                    if (data.status !== 'ok') return [];
                    // Noticias de Real Madrid y Barcelona, con miniatura real
                    let items = (data.items || [])
                        .filter(item => item.title && item.link && getItemImage(item));
                    const filtered = items.filter(item =>
                        feed.keywords.length === 0 ||
                        feed.keywords.some(k => item.title.toLowerCase().includes(k))
                    );
                    items = (filtered.length > 0 ? filtered : items)
                        .slice(0, 3)
                        .map(item => ({ ...item, source: feed.name }));
                    return items;
                } catch (error) {
                    console.error('Error con feed de noticias:', feed.name, error);
                    return [];
                }
            }));
            // Intercalar feeds (round-robin) para mezclar Real Madrid y Barcelona
            const mixed = [];
            const seen = new Set();
            const maxLen = Math.max(...results.map(r => r.length), 0);
            for (let i = 0; i < maxLen; i++) {
                for (const list of results) {
                    if (list[i] && !seen.has(list[i].link)) {
                        seen.add(list[i].link);
                        mixed.push(list[i]);
                    }
                }
            }
            const items = mixed.slice(0, 6);
            if (items.length > 0) {
                renderNews(items);
            } else {
                newsGrid.innerHTML = '<p class="news-error">No se pudieron cargar las noticias. Intenta de nuevo más tarde.</p>';
            }
        }

        function renderNews(items) {
            newsGrid.innerHTML = '';
            items.forEach(item => {
                const card = document.createElement('a');
                card.className = 'news-card';
                card.href = item.link;
                card.target = '_blank';
                card.rel = 'noopener noreferrer';

                const img = document.createElement('img');
                img.src = getItemImage(item);
                img.alt = item.title || 'Noticia deportiva';
                img.loading = 'lazy';
                img.onerror = () => { img.src = 'radio_background.png'; };

                const info = document.createElement('div');
                info.className = 'news-info';

                const title = document.createElement('h3');
                title.textContent = item.title || 'Noticia deportiva';

                const meta = document.createElement('div');
                meta.className = 'news-meta';
                const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '';
                meta.innerHTML = '<i class="fas fa-newspaper"></i> ' + (item.source || 'Deportes') + ' &middot; ' + date;

                info.appendChild(title);
                info.appendChild(meta);
                card.appendChild(img);
                card.appendChild(info);
                newsGrid.appendChild(card);
            });
        }

        loadNews();
    }

    // Top 5 Canciones - Reproductor
    const top5List = document.querySelector('.top5-list');
    if (top5List) {
        const audio = new Audio();
        let currentItem = null;

        function resetPlayIcons() {
            document.querySelectorAll('.top5-item').forEach(item => {
                item.classList.remove('playing');
                const icon = item.querySelector('.top5-play i');
                if (icon) icon.className = 'fas fa-play';
            });
        }

        function playItem(item) {
            const src = item.dataset.audio;
            if (!src) return;
            if (currentItem === item && !audio.paused) {
                audio.pause();
                item.classList.remove('playing');
                const icon = item.querySelector('.top5-play i');
                if (icon) icon.className = 'fas fa-play';
                currentItem = null;
                return;
            }
            resetPlayIcons();
            // La radio se pausa mientras suena la canción del Top Crazy
            if (isPlaying) {
                radioPausedForTop5 = true;
                togglePlay();
            } else {
                radioPausedForTop5 = false;
            }
            audio.src = src;
            audio.play().catch(err => {
                console.error('Error al reproducir audio:', err);
                // Si no pudo sonar la canción, la radio vuelve de inmediato
                if (radioPausedForTop5) {
                    radioPausedForTop5 = false;
                    togglePlay();
                }
            });
            currentItem = item;
            item.classList.add('playing');
            const icon = item.querySelector('.top5-play i');
            if (icon) icon.className = 'fas fa-pause';
        }

        top5List.addEventListener('click', (e) => {
            const item = e.target.closest('.top5-item');
            if (item) playItem(item);
        });

        audio.addEventListener('ended', () => {
            if (currentItem) {
                currentItem.classList.remove('playing');
                const icon = currentItem.querySelector('.top5-play i');
                if (icon) icon.className = 'fas fa-play';
                currentItem = null;
            }
        });

        audio.addEventListener('pause', () => {
            if (currentItem) {
                currentItem.classList.remove('playing');
                const icon = currentItem.querySelector('.top5-play i');
                if (icon) icon.className = 'fas fa-play';
            }
            // Al pausar o terminar la canción, la radio vuelve a sonar
            if (radioPausedForTop5) {
                radioPausedForTop5 = false;
                togglePlay();
            }
        });
    }

    // ===== Compartir Master Crazy TV: enlace directo + toque sostenido =====
    // Link directo: ...#mctv -> al abrir, entra directo a la transmisión en vivo.
    const MCTV_SHARE_HASH = '#mctv';

    function getMctvShareUrl() {
        return location.origin + location.pathname + MCTV_SHARE_HASH;
    }

    function fallbackCopy(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) { return false; }
    }

    let shareToastTimer = null;
    function showShareToast(msg) {
        let toast = document.getElementById('share-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'share-toast';
            toast.className = 'share-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        if (shareToastTimer) clearTimeout(shareToastTimer);
        shareToastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2600);
    }

    // Copia el enlace directo y muestra confirmación (toast inmediato, copia async)
    window.shareMctv = function () {
        const url = getMctvShareUrl();
        // Confirmación visual inmediata (no depende del permiso de clipboard)
        const btn = document.getElementById('mctv-share-btn');
        if (btn) {
            btn.classList.add('copied');
            setTimeout(function () { btn.classList.remove('copied'); }, 1800);
        }
        showShareToast('🔗 Enlace copiado');
        // Copia al portapapeles (con respaldo ejecCommand)
        const doCopy = function () {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).catch(function () { fallbackCopy(url); });
            } else {
                fallbackCopy(url);
            }
        };
        if (document.hasFocus && document.hasFocus()) {
            doCopy();
        } else {
            // Sin foco (toque sostenido en móvil): esperar un tick y copiar
            setTimeout(doCopy, 50);
        }
    };

    // Toque sostenido (long-press) en la tarjeta MASTER CRAZY TV:
    // mantener presionado ~600ms copia el enlace directo sin abrir el video.
    (function () {
        const card = document.getElementById('master-crazy-tv-card');
        const btn = document.getElementById('mctv-share-btn');
        if (!card) return;
        let pressTimer = null;
        let longPressFired = false;
        let startX = 0, startY = 0;

        function cancelPress() {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            longPressFired = false;
        }

        card.addEventListener('touchstart', function (e) {
            longPressFired = false;
            const t = e.touches && e.touches[0];
            startX = t ? t.clientX : 0;
            startY = t ? t.clientY : 0;
            cancelPress();
            pressTimer = setTimeout(function () {
                longPressFired = true;
                if (navigator.vibrate) { try { navigator.vibrate(60); } catch (err) { } }
                shareMctv();
            }, 600);
        }, { passive: true });

        card.addEventListener('touchmove', function (e) {
            const t = e.touches && e.touches[0];
            if (t && (Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12)) {
                cancelPress();
            }
        }, { passive: true });

        card.addEventListener('touchend', function () {
            cancelPress();
        });
        card.addEventListener('touchcancel', function () {
            cancelPress();
        });

        // Si fue long-press, evitar el click que abriría el video
        card.addEventListener('click', function (e) {
            if (longPressFired) {
                e.preventDefault();
                e.stopPropagation();
                longPressFired = false;
            }
        });
    })();

    // Deep-link: si la URL trae #mctv, ir directo a la tarjeta y abrir la transmisión.
    function handleMctvDeepLink() {
        if (location.hash !== MCTV_SHARE_HASH) return;
        const card = document.getElementById('master-crazy-tv-card');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.remove('tv-card-flash');
            void card.offsetWidth;
            card.classList.add('tv-card-flash');
            setTimeout(function () { card.classList.remove('tv-card-flash'); }, 2400);
            // Abrir la transmisión directamente (dentro del video)
            setTimeout(function () {
                if (typeof window.requestMctvAccess === 'function') {
                    window.requestMctvAccess();
                } else if (typeof window.playPartido === 'function') {
                    window.playPartido();
                }
                // Modo deep-link: el modal ocupa el 100% de la pantalla en cualquier
                // dispositivo (CSS puro, no depende de la API fullscreen que los móviles
                // bloquean sin gesto). El video se ve en zoom-crop: cero barras negras.
                const m = document.getElementById('tv-modal');
                if (m) m.classList.add('deep-link-mode');
                applyForcedLandscape();
                setTimeout(function () {
                    if (typeof window.expandTvFullscreen === 'function') {
                        window.expandTvFullscreen();
                    }
                    showTvAudioOverlay();
                }, 400);
            }, 700);
        }
    }

    // Overlay de audio: el navegador bloquea el autoplay con sonido hasta que el
    // usuario interactúa. Se muestra al entrar por link directo y un toque lo desbloquea.
    function showTvAudioOverlay() {
        const ov = document.getElementById('tv-audio-overlay');
        if (ov) ov.style.display = 'flex';
    }

    function hideTvAudioOverlay() {
        const ov = document.getElementById('tv-audio-overlay');
        if (ov) ov.style.display = 'none';
    }

    window.activateTvAudio = function () {
        hideTvAudioOverlay();
        // El toque del usuario desbloquea el autoplay con sonido:
        // recargar el embed para que arranque con audio
        try {
            const iframe = document.getElementById('tv-iframe');
            const src = iframe ? iframe.src : '';
            if (iframe) {
                iframe.src = '';
                setTimeout(function () { iframe.src = src; }, 150);
            }
        } catch (e) { }
        // Reforzar fullscreen/landscape tras el gesto
        setTimeout(function () {
            if (typeof window.expandTvFullscreen === 'function') {
                window.expandTvFullscreen();
            }
        }, 500);
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { } }
    };

    // Giroscopio forzado: en portrait el video rota 90 grados para verse horizontal,
    // mientras los botones (X y maximizar) quedan fijos y visibles.
    function applyForcedLandscape() {
        const modal = document.getElementById('tv-modal');
        if (!modal || !modal.classList.contains('deep-link-mode')) return;
        if (window.innerHeight > window.innerWidth) {
            modal.classList.add('forced-landscape');
        } else {
            modal.classList.remove('forced-landscape');
        }
    }
    window.addEventListener('resize', function () {
        const modal = document.getElementById('tv-modal');
        if (modal && modal.classList.contains('deep-link-mode')) applyForcedLandscape();
    });
    window.addEventListener('orientationchange', function () {
        setTimeout(applyForcedLandscape, 350);
    });
    // ===== PIN de acceso · Master Crazy TV =====
    // Gate de acceso a la transmisión de la tarjeta "Master Crazy TV".
    // PIN correcto: 2468. Si el usuario no lo tiene, se le redirige a WhatsApp.
    (function () {
        const PIN_CORRECTO = '2468';
        const WHATSAPP_URL = 'https://wa.me/573117307017?text=' +
            encodeURIComponent('Hola, quiero el PIN para ver Master Crazy TV');
        const STORAGE_KEY = 'mctv_pin_ok';

        const pinModal = document.getElementById('pin-modal');
        // Si la ventana de PIN no existe (p. ej. HTML servido desde una cache
        // antigua), NO se rompe nada: la tarjeta reproduce directamente.
        const inputs = pinModal ? Array.prototype.slice.call(pinModal.querySelectorAll('.pin-digit')) : [];
        const errorEl = document.getElementById('pin-error');
        const submitBtn = document.getElementById('pin-submit');
        const closeBtn = document.getElementById('pin-close');
        const helpLink = document.getElementById('pin-help');
        if (helpLink) helpLink.href = WHATSAPP_URL;

        function tieneAcceso() {
            try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
        }
        function guardarAcceso() {
            try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { }
        }
        function redirigirAWhatsApp() {
            window.location.href = WHATSAPP_URL;
        }
        function abrirPin() {
            if (!pinModal) return;
            pinModal.classList.add('open');
            if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
            inputs.forEach(function (i) { i.value = ''; });
            setTimeout(function () { if (inputs[0]) inputs[0].focus(); }, 60);
        }
        function cerrarPin() {
            if (!pinModal) return;
            pinModal.classList.remove('open');
        }
        let pinValido = false;

        // auto = true cuando se dispara al completar los 4 dígitos (sin toque).
        // En ese caso NO se abre la transmisión: los navegadores solo permiten
        // pantalla completa con un toque real del usuario.
        function validarPin(auto) {
            const pin = inputs.map(function (i) { return i.value; }).join('');
            if (pin.length < 4) {
                if (errorEl) {
                    errorEl.textContent = 'Ingresa los 4 dígitos.';
                    errorEl.style.display = 'block';
                }
                return;
            }
            if (pin === PIN_CORRECTO) {
                guardarAcceso();
                pinValido = true;
                // Abrir de inmediato apenas se completa el PIN (como pidio el
                // usuario). abrirTransmision cierra el teclado y luego pide la
                // pantalla completa.
                abrirTransmision();
            } else {
                pinValido = false;
                if (errorEl) {
                    errorEl.style.color = '#ff6b81';
                    errorEl.textContent = 'PIN incorrecto. Te llevamos a WhatsApp para solicitarlo…';
                    errorEl.style.display = 'block';
                }
                setTimeout(redirigirAWhatsApp, 1600);
            }
        }

        // Abre la transmisión pidiendo la pantalla completa DENTRO del toque
        function abrirTransmision() {
            // Cerrar el teclado ANTES de pedir pantalla completa: con el teclado
            // abierto, el navegador sale de pantalla completa para mostrarlo.
            try {
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            } catch (e) { }
            cerrarPin();
            // Esperar a que el teclado termine de cerrarse ANTES de pedir la
            // pantalla completa (si no, el navegador la cancela).
            setTimeout(function () {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    requestFullscreenVertical(document.documentElement);
                }
                if (typeof window.tvDebug === 'function') window.tvDebug('PIN ok');
                if (typeof window.playPartido === 'function') window.playPartido();
            }, 450);
        }

        inputs.forEach(function (input, idx) {
            input.addEventListener('input', function () {
                input.value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
                if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
                if (inputs.every(function (i) { return i.value.length === 1; })) validarPin(true);
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
                if (e.key === 'Enter') validarPin(false);
            });
            input.addEventListener('focus', function () { input.select(); });
        });

        function cancelarPin() {
            cerrarPin();
            const tv = document.getElementById('tv-modal');
            const tvAbierto = !!tv && tv.style.display === 'flex';
            if (tvAbierto) return;
            // Si el usuario cancela el PIN, se sale de pantalla completa
            try {
                if (document.fullscreenElement && document.exitFullscreen) {
                    document.exitFullscreen().catch(function () { });
                } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            } catch (e) { }
        }

        if (submitBtn) submitBtn.addEventListener('click', function () { validarPin(false); });
        if (closeBtn) closeBtn.addEventListener('click', cancelarPin);
        if (pinModal) {
            pinModal.addEventListener('click', function (e) { if (e.target === pinModal) cancelarPin(); });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && pinModal && pinModal.classList.contains('open')) cancelarPin();
        });

        // Punto de entrada de la tarjeta Master Crazy TV.
        // SIEMPRE definido: si la ventana de PIN no esta disponible, reproduce
        // directamente para no perder nunca la transmision.
        window.requestMctvAccess = function () {
            // NO se pide pantalla completa aqui: si se activa y luego se abre el
            // teclado del PIN, el navegador sale de pantalla completa y ya no la
            // vuelve a conceder. Se pide al abrir la transmision, con un toque real.
            if (tieneAcceso() || !pinModal) {
                if (typeof window.playPartido === 'function') window.playPartido();
                return;
            }
            abrirPin();
        };
    })();

    // ===== Ajuste de imagen del reproductor de TV (Llenar / Completo) =====
    // "Llenar" (tv-fit-cover): la imagen cubre TODA la pantalla (puede recortar
    // los bordes). "Completo": se ve la imagen entera (barras negras si sobran).
    // El modo se recuerda por equipo en localStorage.
    function applyTvFitMode() {
        const modal = document.getElementById('tv-modal');
        if (!modal) return;
        let mode = 'cover';
        try { mode = localStorage.getItem('mctv_fit_mode') || 'cover'; } catch (e) { }
        modal.classList.toggle('tv-fit-cover', mode === 'cover');
    }
    window.toggleTvFitMode = function () {
        const modal = document.getElementById('tv-modal');
        if (!modal) return;
        const cover = !modal.classList.contains('tv-fit-cover');
        modal.classList.toggle('tv-fit-cover', cover);
        try { localStorage.setItem('mctv_fit_mode', cover ? 'cover' : 'contain'); } catch (e) { }
    };
    applyTvFitMode();
    document.addEventListener('DOMContentLoaded', applyTvFitMode);

    // ===== Controles auto-ocultables (5 s) del reproductor de TV =====
    // Los botones (cerrar, ampliar, ajuste) desaparecen a los 5 segundos y
    // vuelven con un toque en la pantalla.
    (function () {
        const HIDE_MS = 5000;
        let hideTimer = null;

        function getModal() { return document.getElementById('tv-modal'); }

        function mostrarControles() {
            const modal = getModal();
            if (!modal) return;
            modal.classList.remove('controls-hidden');
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(ocultarControles, HIDE_MS);
        }

        function ocultarControles() {
            const modal = getModal();
            if (!modal || modal.style.display !== 'flex') return;
            // No ocultar mientras esté visible el aviso de activar audio
            const audio = document.getElementById('tv-audio-overlay');
            if (audio && audio.style.display !== 'none') {
                hideTimer = setTimeout(ocultarControles, HIDE_MS);
                return;
            }
            modal.classList.add('controls-hidden');
        }

        // Cualquier interacción reinicia la cuenta atrás
        ['mousemove', 'touchstart', 'click', 'keydown'].forEach(function (ev) {
            document.addEventListener(ev, function () {
                const modal = getModal();
                if (modal && modal.style.display === 'flex') mostrarControles();
            }, true);
        });

        // Toque sobre el video (el iframe tapa la pantalla: zona de toque propia)
        const catcher = document.getElementById('tv-tap-catcher');
        if (catcher) {
            catcher.addEventListener('click', function (e) {
                e.stopPropagation();
                const m = getModal();
                if (m && m.classList.contains('tv-mini')) {
                    if (typeof window.exitMiniTv === 'function') window.exitMiniTv();
                    return;
                }
                mostrarControles();
            });
            catcher.addEventListener('touchstart', function (e) {
                e.stopPropagation();
                mostrarControles();
            }, { passive: true });
        }

        // Arrancar el temporizador cada vez que se abre el modal
        const modal = getModal();
        if (modal && window.MutationObserver) {
            new MutationObserver(function () {
                if (modal.style.display === 'flex') {
                    mostrarControles();
                } else {
                    if (hideTimer) clearTimeout(hideTimer);
                    modal.classList.remove('controls-hidden');
                }
            }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        }

        window.startTvControlsTimer = mostrarControles;
    })();

    // ===== Salida sin boton "cerrar" =====
    // El boton/gesto ATRAS ya lo maneja el codigo original del sitio
    // (tvModalHistoryPushed + popstate). Aqui solo se agrega la tecla Escape
    // para computador. NO se duplica el manejo del historial: hacerlo hacia
    // que el navegador rebotara de vuelta a la pagina principal.
    (function () {
        let pushed = false;
        function getModal() { return document.getElementById('tv-modal'); }
        function isOpen() {
            const m = getModal();
            return !!m && m.style.display === 'flex';
        }
        function cerrar() {
            if (typeof window.closeTvModal === 'function') window.closeTvModal();
        }
        // El historial NO se toca aqui (ver nota de arriba)
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) cerrar();
        });
    })();

    window.addEventListener('hashchange', handleMctvDeepLink);
    // Al cargar la página ya con #mctv (después del DOMContentLoaded)
    setTimeout(handleMctvDeepLink, 1200);

});
