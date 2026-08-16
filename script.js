document.addEventListener('DOMContentLoaded', () => {
    // Audio Player Logic
    const streamUrl = 'https://stream.zeno.fm/zadzh811p48uv';
    const audio = new Audio(streamUrl);
    const playBtn = document.getElementById('play-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeIcon = document.getElementById('volume-icon');
    const icon = playBtn.querySelector('i');
    const songTitleElement = document.getElementById('song-title');
    const floatingPlayer = document.getElementById('floating-player');
    const floatingPlayBtn = document.getElementById('floating-play-btn');
    const floatingIcon = floatingPlayBtn ? floatingPlayBtn.querySelector('i') : null;
    const floatingSongTitle = document.getElementById('floating-song-title');
    let isPlaying = false;

    function syncPlayState() {
        if (icon) {
            icon.classList.remove('fa-pause', 'fa-play');
            icon.classList.add(isPlaying ? 'fa-pause' : 'fa-play');
        }
        if (floatingIcon) {
            floatingIcon.classList.remove('fa-pause', 'fa-play');
            floatingIcon.classList.add(isPlaying ? 'fa-pause' : 'fa-play');
        }
        if (floatingPlayer) {
            floatingPlayer.classList.toggle('playing', isPlaying);
        }
    }

    function togglePlay() {
        if (isPlaying) {
            audio.pause();
            isPlaying = false;
        } else {
            audio.play().catch(error => {
                console.error("Playback failed:", error);
                alert("Error al reproducir. Verifica tu conexión o intenta más tarde.");
            });
            isPlaying = true;
        }
        syncPlayState();
    }

    // Play/Pause (botón principal y flotante sincronizados)
    playBtn.addEventListener('click', togglePlay);
    if (floatingPlayBtn) {
        floatingPlayBtn.addEventListener('click', togglePlay);
    }

    // Mostrar reproductor flotante: siempre visible al hacer scroll
    function updateFloatingPlayer() {
        if (!floatingPlayer) return;
        // Una vez visible, permanece visible para que siempre esté disponible
        if (window.scrollY > 100 || floatingPlayer.classList.contains('visible')) {
            floatingPlayer.classList.add('visible');
        }
    }
    window.addEventListener('scroll', updateFloatingPlayer, { passive: true });
    updateFloatingPlayer();

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
                    if (floatingSongTitle) floatingSongTitle.innerText = titleText;
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
        const title = document.getElementById('channel-name');

        // Stop radio audio if playing
        const playBtn = document.getElementById('play-btn');
        const icon = playBtn.querySelector('i');
        if (icon.classList.contains('fa-pause')) {
            playBtn.click(); // This will pause the radio
        }

        modal.style.display = 'flex';
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
                video.play();
                title.innerText = channelId.toUpperCase() + " TV";
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
                video.play();
                title.innerText = channelId.toUpperCase() + " TV";
            });
            video.addEventListener('error', handleStreamError);
        }
    };

    window.closeTvModal = function () {
        const modal = document.getElementById('tv-modal');
        const video = document.getElementById('tv-player');

        video.pause();
        video.src = "";
        if (window.hls) {
            window.hls.destroy();
        }

        modal.style.display = 'none';
    };

    // Close modal on click outside
    window.onclick = function (event) {
        const modal = document.getElementById('tv-modal');
        if (event.target == modal) {
            closeTvModal();
        }
    };

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
            return (item.enclosure && item.enclosure.link) || item.thumbnail || '';
        }

        async function loadNews() {
            newsGrid.innerHTML = '<p class="news-loading">Cargando noticias deportivas...</p>';
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
