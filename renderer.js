/* ========================================
   番茄时钟 - 渲染进程逻辑
   ======================================== */

// ==================== 状态管理 ====================
const state = {
  mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
  isRunning: false,
  timeLeft: 25 * 60, // 秒
  totalTime: 25 * 60,
  completedPomodoros: 0,
  totalFocusMinutes: 0,
  currentStreak: 0,
  lastCompletionDate: null,
  activeSessionMinutes: 25,
  runningStartedAt: null,
  runningStartedWallTime: null,
  runningStartedTimeLeft: null,
  
  // 设置
  settings: {
    focusDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    longBreakInterval: 4,
    soundEnabled: true,
    autoStartBreaks: false
  }
};

// ==================== DOM 元素 ====================
const elements = {
  timerDisplay: document.getElementById('timerDisplay'),
  timerLabel: document.getElementById('timerLabel'),
  progressRing: document.getElementById('progressRing'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  pauseIcon: document.getElementById('pauseIcon'),
  resetBtn: document.getElementById('resetBtn'),
  skipBtn: document.getElementById('skipBtn'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  timerContainer: document.querySelector('.timer-container'),
  
  // 统计
  completedPomodoros: document.getElementById('completedPomodoros'),
  totalFocusTime: document.getElementById('totalFocusTime'),
  currentStreak: document.getElementById('currentStreak'),
  
  // 设置
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.querySelector('.settings-panel'),
  settingsContent: document.getElementById('settingsContent'),
  
  // 设置输入
  focusDuration: document.getElementById('focusDuration'),
  shortBreakDuration: document.getElementById('shortBreakDuration'),
  longBreakDuration: document.getElementById('longBreakDuration'),
  longBreakInterval: document.getElementById('longBreakInterval'),
  soundEnabled: document.getElementById('soundEnabled'),
  autoStartBreaks: document.getElementById('autoStartBreaks'),
  
  // 托盘提示
  tip: document.getElementById('tip')
};

// ==================== 定时器 ====================
let timerInterval = null;
let timerEndTime = null;
let pendingCompletionAfterLoad = false;
const CIRCUMFERENCE = 2 * Math.PI * 90; // 圆的周长

// ==================== 初始化 ====================
function init() {
  loadState();
  setupEventListeners();
  setupElectronListeners();
  updateDisplay();
  updateTimerRing();
  updateStats();
  if (pendingCompletionAfterLoad) {
    pendingCompletionAfterLoad = false;
    onTimerComplete();
  }
  log('番茄时钟已初始化');
}

// 加载保存的状态
function loadState() {
  try {
    const saved = localStorage.getItem('pomodoroState');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state.settings, parsed.settings || {});
      
      // 恢复统计
      state.completedPomodoros = parsed.completedPomodoros || 0;
      state.totalFocusMinutes = parsed.totalFocusMinutes || 0;
      state.currentStreak = parsed.currentStreak || 0;
      state.lastCompletionDate = parsed.lastCompletionDate;
      state.mode = parsed.mode || state.mode;
      state.totalTime = Number.isFinite(parsed.totalTime) ? parsed.totalTime : state.totalTime;
      state.timeLeft = Number.isFinite(parsed.timeLeft) ? parsed.timeLeft : state.timeLeft;
      state.activeSessionMinutes = Number.isFinite(parsed.activeSessionMinutes)
        ? parsed.activeSessionMinutes
        : Math.round(state.totalTime / 60);
      
      // 更新设置控件
      elements.focusDuration.value = state.settings.focusDuration;
      elements.shortBreakDuration.value = state.settings.shortBreakDuration;
      elements.longBreakDuration.value = state.settings.longBreakDuration;
      elements.longBreakInterval.value = state.settings.longBreakInterval;
      elements.soundEnabled.checked = state.settings.soundEnabled;
      elements.autoStartBreaks.checked = state.settings.autoStartBreaks;

      restoreModeUi();
      restoreRunningTimer(parsed);
      
      // 检查连续天数
      checkStreak();
    }
  } catch (e) {
    log('加载状态失败:', e);
  }
}

// 保存状态
function saveState() {
  try {
    const toSave = {
      settings: state.settings,
      mode: state.mode,
      isRunning: state.isRunning,
      timeLeft: state.timeLeft,
      totalTime: state.totalTime,
      activeSessionMinutes: state.activeSessionMinutes,
      runningStartedAt: state.runningStartedAt,
      runningStartedWallTime: state.runningStartedWallTime,
      runningStartedTimeLeft: state.runningStartedTimeLeft,
      completedPomodoros: state.completedPomodoros,
      totalFocusMinutes: state.totalFocusMinutes,
      currentStreak: state.currentStreak,
      lastCompletionDate: state.lastCompletionDate
    };
    localStorage.setItem('pomodoroState', JSON.stringify(toSave));
  } catch (e) {
    log('保存状态失败:', e);
  }
}

function getMonotonicNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function restoreModeUi() {
  elements.modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  });
  updateTimerColor();
}

function restoreRunningTimer(parsed) {
  const startedTimeLeft = Number.isFinite(parsed.runningStartedTimeLeft)
    ? parsed.runningStartedTimeLeft
    : parsed.timeLeft;

  if (!parsed.isRunning || !Number.isFinite(startedTimeLeft)) {
    state.isRunning = false;
    return;
  }

  const elapsedMs = getElapsedSinceStart(parsed);
  state.timeLeft = Math.max(0, Math.ceil((startedTimeLeft * 1000 - elapsedMs) / 1000));

  if (state.timeLeft <= 0) {
    state.isRunning = true;
    pendingCompletionAfterLoad = true;
    return;
  }

  state.isRunning = true;
  state.runningStartedAt = getMonotonicNow();
  state.runningStartedWallTime = Date.now();
  state.runningStartedTimeLeft = state.timeLeft;
  timerEndTime = state.runningStartedAt + state.timeLeft * 1000;
  elements.playIcon.style.display = 'none';
  elements.pauseIcon.style.display = 'block';
  elements.timerContainer.classList.add('running');
  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);
}

function getElapsedSinceStart(parsed) {
  if (Number.isFinite(parsed.runningStartedAt)) {
    const monotonicElapsed = getMonotonicNow() - parsed.runningStartedAt;
    if (monotonicElapsed >= 0) {
      return monotonicElapsed;
    }
  }

  if (Number.isFinite(parsed.runningStartedWallTime)) {
    return Math.max(0, Date.now() - parsed.runningStartedWallTime);
  }

  return 0;
}

// ==================== 事件监听 ====================
function setupEventListeners() {
  // 播放/暂停按钮
  elements.playBtn.addEventListener('click', toggleTimer);
  
  // 重置按钮
  elements.resetBtn.addEventListener('click', resetTimer);
  
  // 跳过按钮
  elements.skipBtn.addEventListener('click', skipToNext);
  
  // 模式选择
  elements.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
  
  // 设置面板
  elements.settingsToggle.addEventListener('click', toggleSettings);
  
  // 设置输入
  elements.focusDuration.addEventListener('change', (e) => updateSetting('focusDuration', e.target.value));
  elements.shortBreakDuration.addEventListener('change', (e) => updateSetting('shortBreakDuration', e.target.value));
  elements.longBreakDuration.addEventListener('change', (e) => updateSetting('longBreakDuration', e.target.value));
  elements.longBreakInterval.addEventListener('change', (e) => updateSetting('longBreakInterval', e.target.value));
  elements.soundEnabled.addEventListener('change', (e) => updateSetting('soundEnabled', e.target.checked));
  elements.autoStartBreaks.addEventListener('change', (e) => updateSetting('autoStartBreaks', e.target.checked));
  
  // 设置调整按钮
  document.querySelectorAll('.setting-adjust').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const delta = parseInt(btn.dataset.delta);
      const input = document.getElementById(target);
      const newValue = Math.max(parseInt(input.min), Math.min(parseInt(input.max), parseInt(input.value) + delta));
      input.value = newValue;
      input.dispatchEvent(new Event('change'));
    });
  });
  
  // 键盘快捷键
  document.addEventListener('keydown', handleKeydown);
}

// 设置 Electron 监听器
function setupElectronListeners() {
  if (window.electronAPI) {
    window.electronAPI.onTrayToggle(() => toggleTimer());
    window.electronAPI.onTrayReset(() => resetTimer());
    
    // 清理监听器
    window.addEventListener('beforeunload', () => {
      window.electronAPI.removeTrayListeners();
    });
  }
}

// 键盘快捷键处理
function handleKeydown(e) {
  // 空格键 - 播放/暂停
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    toggleTimer();
  }
  
  // R 键 - 重置
  if (e.code === 'KeyR' && e.target.tagName !== 'INPUT') {
    resetTimer();
  }
  
  // 1/2/3 键 - 切换模式
  if (e.code === 'Digit1' && e.target.tagName !== 'INPUT') {
    switchMode('focus');
  }
  if (e.code === 'Digit2' && e.target.tagName !== 'INPUT') {
    switchMode('shortBreak');
  }
  if (e.code === 'Digit3' && e.target.tagName !== 'INPUT') {
    switchMode('longBreak');
  }
}

// ==================== 计时器控制 ====================
function toggleTimer() {
  if (state.isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  if (state.isRunning || state.timeLeft <= 0) {
    return;
  }

  state.isRunning = true;
  state.runningStartedAt = getMonotonicNow();
  state.runningStartedWallTime = Date.now();
  state.runningStartedTimeLeft = state.timeLeft;
  state.activeSessionMinutes = Math.round(state.totalTime / 60);
  timerEndTime = state.runningStartedAt + state.timeLeft * 1000;
  elements.playIcon.style.display = 'none';
  elements.pauseIcon.style.display = 'block';
  elements.timerContainer.classList.add('running');
  
  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);
  updateTrayTooltip();
  saveState();
  log('计时器已启动');
}

function pauseTimer() {
  if (state.isRunning) {
    syncTimerWithClock();
  }

  state.isRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerEndTime = null;
  state.runningStartedAt = null;
  state.runningStartedWallTime = null;
  state.runningStartedTimeLeft = null;
  elements.playIcon.style.display = 'block';
  elements.pauseIcon.style.display = 'none';
  elements.timerContainer.classList.remove('running');
  
  updateTrayTooltip();
  saveState();
  log('计时器已暂停');
}

function resetTimer() {
  pauseTimer();
  setDurationForMode(state.mode);
  updateDisplay();
  updateTimerRing();
  saveState();
  log('计时器已重置');
}

function tick() {
  if (!state.isRunning) {
    return;
  }

  syncTimerWithClock();
  updateDisplay();
  updateTimerRing();
  updateTrayTooltip();

  if (state.timeLeft <= 0) {
    onTimerComplete();
  }
}

function syncTimerWithClock() {
  if (!timerEndTime) {
    return;
  }

  const remainingMs = timerEndTime - getMonotonicNow();
  state.timeLeft = Math.max(0, Math.ceil(remainingMs / 1000));
}

function onTimerComplete() {
  completeCurrentMode(true);
}

function completeCurrentMode(shouldCountCompletion) {
  const completedMode = state.mode;
  const completedDurationMinutes = state.activeSessionMinutes || Math.round(state.totalTime / 60);
  pauseTimer();
  
  if (completedMode === 'focus') {
    // 完成一个番茄
    if (shouldCountCompletion) {
      state.completedPomodoros++;
      state.totalFocusMinutes += completedDurationMinutes;
      state.lastCompletionDate = new Date().toDateString();
    }
    
    // 检查是否应该开始长休息
    if (shouldCountCompletion && state.completedPomodoros % state.settings.longBreakInterval === 0) {
      switchMode('longBreak');
    } else {
      switchMode('shortBreak');
    }
    
    // 检查连续天数
    if (shouldCountCompletion) {
      checkStreak();
    }
  } else {
    // 休息结束，回到专注模式
    switchMode('focus');
  }
  
  if (!shouldCountCompletion) {
    saveState();
    updateStats();
    log('跳过计时: ' + completedMode);
    return;
  }

  // 播放提示音
  playNotificationSound(completedMode);
  
  // 显示通知
  showNotification(completedMode, completedDurationMinutes);
  
  // 保存状态
  saveState();
  updateStats();
  
  // 自动开始休息（如果启用）
  if (state.mode !== 'focus' && state.settings.autoStartBreaks) {
    startTimer();
  }
  
  log('计时完成: ' + completedMode);
}

// ==================== 模式切换 ====================
function switchMode(mode) {
  pauseTimer();
  state.mode = mode;
  
  // 更新 UI
  elements.modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  
  // 更新颜色
  updateTimerColor();
  
  // 设置时长
  setDurationForMode(mode);
  
  // 更新显示
  updateDisplay();
  updateTimerRing();
  
  log('切换模式: ' + mode);
}

function setDurationForMode(mode) {
  switch (mode) {
    case 'focus':
      state.totalTime = state.settings.focusDuration * 60;
      break;
    case 'shortBreak':
      state.totalTime = state.settings.shortBreakDuration * 60;
      break;
    case 'longBreak':
      state.totalTime = state.settings.longBreakDuration * 60;
      break;
  }
  state.timeLeft = state.totalTime;
  state.activeSessionMinutes = Math.round(state.totalTime / 60);
}

function skipToNext() {
  completeCurrentMode(false);
}

// ==================== UI 更新 ====================
function updateDisplay() {
  const minutes = Math.floor(state.timeLeft / 60);
  const seconds = state.timeLeft % 60;
  elements.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // 更新标签
  const labels = {
    focus: '专注时间',
    shortBreak: '短休息',
    longBreak: '长休息'
  };
  elements.timerLabel.textContent = labels[state.mode];
}

function updateTimerRing() {
  const progress = state.timeLeft / state.totalTime;
  const offset = CIRCUMFERENCE * (1 - progress);
  elements.progressRing.style.strokeDashoffset = offset;
}

function updateTimerColor() {
  const colors = {
    focus: '#e94560',
    shortBreak: '#00d9ff',
    longBreak: '#7c3aed'
  };
  elements.progressRing.style.stroke = colors[state.mode];
}

function updateStats() {
  elements.completedPomodoros.textContent = state.completedPomodoros;
  elements.totalFocusTime.textContent = state.totalFocusMinutes;
  elements.currentStreak.textContent = state.currentStreak;
}

function updateTrayTooltip() {
  if (window.electronAPI) {
    const status = state.isRunning ? '运行中' : '已暂停';
    const time = elements.timerDisplay.textContent;
    const modeNames = {
      focus: '专注',
      shortBreak: '短休息',
      longBreak: '长休息'
    };
    window.electronAPI.updateTooltip(`🍅 ${modeNames[state.mode]} - ${time} [${status}]`);
  }
}

function toggleSettings() {
  elements.settingsPanel.classList.toggle('expanded');
}

// ==================== 设置 ====================
function updateSetting(key, value) {
  if (['focusDuration', 'shortBreakDuration', 'longBreakDuration', 'longBreakInterval'].includes(key)) {
    value = sanitizeNumericSetting(key, value);
  }

  state.settings[key] = value;
  
  // 如果改变了当前模式的时长，需要更新
  if (['focusDuration', 'shortBreakDuration', 'longBreakDuration'].includes(key)) {
    if (state.mode === key.replace('Duration', '').replace('focus', 'focus')
        .replace('shortBreak', 'shortBreak')
        .replace('longBreak', 'longBreak')) {
      if (!state.isRunning) {
        setDurationForMode(state.mode);
        updateDisplay();
        updateTimerRing();
      }
    }
  }
  
  saveState();
  log('设置已更新: ' + key + ' = ' + value);
}

function sanitizeNumericSetting(key, value) {
  const input = elements[key];
  const min = input ? parseInt(input.min, 10) : 1;
  const max = input ? parseInt(input.max, 10) : 60;
  let nextValue = parseInt(value, 10);

  if (!Number.isFinite(nextValue)) {
    nextValue = min;
  }

  nextValue = Math.max(min, Math.min(max, nextValue));

  if (input) {
    input.value = String(nextValue);
  }

  return nextValue;
}

// ==================== 连续天数检查 ====================
function checkStreak() {
  const today = new Date().toDateString();
  
  if (state.lastCompletionDate) {
    const lastDate = new Date(state.lastCompletionDate);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays > 1) {
      // 超过一天未完成，重置连续天数
      state.currentStreak = 0;
    } else if (diffDays === 1) {
      // 新的一天，连续天数 +1
      state.currentStreak++;
    }
    // diffDays === 0 时不改变连续天数
  }
}

// ==================== 通知和音效 ====================
function playNotificationSound(completedMode = state.mode) {
  if (!state.settings.soundEnabled) return;
  
  // 使用 Web Audio API 生成提示音
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 播放三次提示音
    [0, 300, 600].forEach((delay, index) => {
      setTimeout(() => {
        playBeep(audioContext, completedMode === 'focus' ? 880 : 440, 150);
      }, delay);
    });
  } catch (e) {
    log('播放音效失败:', e);
  }
}

function playBeep(audioContext, frequency, duration) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration / 1000);
}

function showNotification(completedMode = state.mode, completedDurationMinutes = state.settings.focusDuration) {
  const messages = {
    focus: {
      title: '🍅 番茄时间到！',
      body: `已完成 ${completedDurationMinutes} 分钟专注，继续加油！`
    },
    shortBreak: {
      title: '☕ 休息一下',
      body: `休息 ${state.settings.shortBreakDuration} 分钟，放松眼睛和大脑。`
    },
    longBreak: {
      title: '🌴 太棒了！',
      body: `已完成 ${state.settings.longBreakInterval} 个番茄！休息 ${state.settings.longBreakDuration} 分钟。`
    }
  };
  
  const msg = messages[completedMode];
  
  if (window.electronAPI) {
    window.electronAPI.showNotification(msg.title, msg.body);
  }
  
  // 同时使用系统通知
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(msg.title, { body: msg.body, icon: 'assets/icon.png' });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(msg.title, { body: msg.body, icon: 'assets/icon.png' });
      }
    });
  }
}

// ==================== 日志 ====================
function log(...args) {
  console.log('[Pomodoro]', new Date().toLocaleTimeString(), ...args);
}

// ==================== 启动 ====================
document.addEventListener('DOMContentLoaded', init);
