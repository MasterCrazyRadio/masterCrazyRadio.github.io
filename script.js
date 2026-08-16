// Detección de dispositivo real: el viewport está forzado a 1024 en móviles,
// así que las media queries normales no se disparan. Usamos device-width / userAgent
// (excluyendo TVs) para saber cuándo es un teléfono real.
(function () {
    try {
        var ua = navigator.userAgent;
        var isTV = /(Tizen|Web0S|WebOS|SMART-TV|SmartTV|BRAVIA|Viera|Android TV|AFTT|AFTS|ADT-)/i.test(ua);
        var mqMobile = window.matchMedia && window.matchMedia('(max-device-width: 900px)').matches;
        var smallScreen = window.screen && window.screen.width > 0 && window.screen.width <= 900;
        var uaMobile = /iPhone|iPad|iPod|Android(?! TV)|Opera Mini|IEMobile|Mobile/i.test(ua);
        if (!isTV && (mqMobile || smallScreen || uaMobile)) {
            document.documentElement.classList.add('is-mobile');
        }
    } catch (e) { }
})();

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
            audio.play().catch(error => {
                console.error("Playback failed:", error);
                // Prioridad: reconectarse automáticamente en vez de solo alertar
                scheduleReconnect();
            });
        }
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

    // Spotlight Effect
    const spotlight = document.querySelector('.spotlight');
    document.addEventListener('mousemove', (e) => {
        spotlight.style.left = e.clientX + 'px';
        spotlight.style.top = e.clientY + 'px';
    });

    // 3D Tilt Effect for Player
    const card = document.getElementById('tilt-card');
    const wrapper = document.querySelector('.player-wrapper');

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

    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
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

    // Flyer 3D Tilt Effect (applies to active slide)
    const flyerWrapper = document.querySelector('.flyer-wrapper');

    if (flyerWrapper) {
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
        if (video) video.style.display = '';

        // Stop radio audio if playing
        const playBtn = document.getElementById('play-btn');
        const icon = playBtn.querySelector('i');
        if (icon.classList.contains('fa-pause')) {
            playBtn.click(); // This will pause the radio
        }

        openTvModal(modal);
        // En teléfonos: pantalla completa nativa en vertical
        if (isMobileDevice()) {
            requestFullscreenVertical(modal);
        }
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
    function requestFullscreenVertical(el) {
        try {
            if (el.requestFullscreen) {
                el.requestFullscreen().catch(function () { });
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();
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
        const modal = document.getElementById('tv-modal');
        if (!modal || modal.style.display !== 'flex') return;
        const landscape = window.innerWidth > window.innerHeight;
        modal.classList.toggle('is-landscape', landscape);
        // Si aún no está en fullscreen nativo, pedirlo (para llenar la pantalla)
        if (landscape && !document.fullscreenElement && !document.webkitFullscreenElement) {
            requestFullscreenVertical(modal);
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
        try {
            window.addEventListener('deviceorientation', function () {
                updateTvOrientationClass();
            });
        } catch (e) { }
    }
    try {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
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

    // Navegación: el botón "atrás" del teléfono cierra el reproductor
    // y vuelve a la página de inicio en vez de dejar pantalla negra.
    let tvModalHistoryPushed = false;

    function openTvModal(modal) {
        modal.style.display = 'flex';
        if (!tvModalHistoryPushed) {
            tvModalHistoryPushed = true;
            try { history.pushState({ tvModal: true }, ''); } catch (e) { }
        }
    }

    // Al pulsar "atrás": cerrar el modal en vez de salir de la página
    window.addEventListener('popstate', function () {
        const modal = document.getElementById('tv-modal');
        if (modal && modal.style.display === 'flex') {
            closeTvModal();
            // Re-marcar el historial para que otro "atrás" no salga del sitio
            tvModalHistoryPushed = true;
            try { history.pushState({ tvModal: true }, ''); } catch (e) { }
        }
    });

    // Si el usuario sale del fullscreen nativo (gesto o atrás en Android),
    // cerrar el modal para no dejar pantalla negra
    document.addEventListener('fullscreenchange', function () {
        const modal = document.getElementById('tv-modal');
        if (modal && modal.style.display === 'flex' && !document.fullscreenElement && !document.webkitFullscreenElement) {
            closeTvModal();
        }
    });

    // Partido En Vivo (iframe ok.ru)
    window.playPartido = function () {
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

        // Detener radio si está sonando
        const playBtn = document.getElementById('play-btn');
        const icon = playBtn.querySelector('i');
        if (icon.classList.contains('fa-pause')) {
            playBtn.click();
        }

        // Mostrar el iframe del partido en el modal (autoplay=1 para arrancar solo en móvil)
        if (iframeContainer) iframeContainer.style.display = 'block';
        if (iframe) iframe.src = '//ok.ru/videoembed/13981676805705?autoplay=1&nochat=1';
        openTvModal(modal);
        title.innerHTML = "Partido <span style='color:#7DF9FF;'>En Vivo</span>";

        // En teléfonos: pantalla completa nativa en vertical
        if (isMobileDevice()) {
            requestFullscreenVertical(modal);
        }
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

        // Detener radio si está sonando
        const playBtn = document.getElementById('play-btn');
        const icon = playBtn.querySelector('i');
        if (icon.classList.contains('fa-pause')) {
            playBtn.click();
        }

        // Cargar la señal en vivo oficial de Caracol TV (YouTube embed)
        if (iframeContainer) iframeContainer.style.display = 'block';
        if (iframe) iframe.src = 'https://www.youtube.com/embed/x0eOenDDelg?autoplay=1&rel=0';
        openTvModal(modal);
        title.innerHTML = "Caracol <span style='color:#7DF9FF;'>TV</span> <br><span style='font-size:0.8rem; color:#aaa;'>Señal en vivo</span>";

        // En teléfonos: pantalla completa nativa en vertical
        if (isMobileDevice()) {
            requestFullscreenVertical(modal);
        }
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

        modal.style.display = 'none';
        tvModalHistoryPushed = false;

        // Salir de pantalla completa nativa y desbloquear orientación
        exitFullscreen();
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
    function refreshPartidoStatus() {
        fetch('status.json?ts=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                const badge = document.getElementById('partido-badge');
                const statusMsg = document.getElementById('partido-status');
                if (!badge) return;
                if (data && data.status === 'ONLINE') {
                    badge.textContent = 'EN VIVO';
                    badge.classList.remove('offline');
                    if (statusMsg) statusMsg.style.display = 'none';
                } else {
                    badge.textContent = 'EN PAUSA';
                    badge.classList.add('offline');
                    if (statusMsg) {
                        statusMsg.textContent = (data && data.message) ? data.message : 'Transmisión en pausa — vuelve en un momento';
                        statusMsg.style.display = 'block';
                    }
                }
            })
            .catch(function () { /* sin status.json aun: mantener estado por defecto */ });
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

    // Noticias Deportivas Section
    const newsGrid = document.getElementById('news-grid');
    if (newsGrid) {
        const NEWS_FEEDS = [
            { name: 'Fichajes Barça', url: 'https://e00-marca.uecdn.es/rss/futbol/mercado-fichajes.xml', keywords: ['barça', 'barcelona', 'azulgrana', 'blaugrana', 'ferran torres', 'rodri'] },
            { name: 'Fichajes Real Madrid', url: 'https://e00-marca.uecdn.es/rss/futbol/real-madrid.xml', keywords: ['ficha', 'fichaje', 'mercado', 'traspaso', 'cesión', 'cesion', 'refuerzo', 'firma', 'oferta'] },
            { name: 'Fichajes', url: 'https://www.mundodeportivo.com/rss/futbol/fichajes.xml', keywords: ['barça', 'barcelona', 'real madrid', 'merengue', 'blancos'] }
        ];

        function getItemImage(item) {
            return (item.enclosure && item.enclosure.link) || item.thumbnail || item.image || '';
        }

        // Cargar noticias desde news.json (generado por el vigilante diario de
        // noticias: Real Madrid y Barcelona) y, si no existe, desde los feeds RSS.
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
                    // Rumores de fichajes de Barça y Real Madrid, con miniatura real
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
            const items = mixed.slice(0, 3);
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
            audio.src = src;
            audio.play().catch(err => console.error('Error al reproducir audio:', err));
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
        });
    }
});
