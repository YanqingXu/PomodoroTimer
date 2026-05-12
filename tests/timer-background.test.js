const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '25';
    this.min = '';
    this.max = '';
    this.checked = false;
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    this.tagName = 'DIV';
    this.listeners = {};
    this.classList = {
      add() {},
      remove() {},
      toggle() {}
    };
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  dispatchEvent(event) {
    if (this.listeners[event.type]) {
      this.listeners[event.type](event);
    }
  }
}

function createDocument() {
  const elements = new Map();
  const ids = [
    'timerDisplay',
    'timerLabel',
    'progressRing',
    'playBtn',
    'playIcon',
    'pauseIcon',
    'resetBtn',
    'skipBtn',
    'settingsToggle',
    'settingsContent',
    'focusDuration',
    'shortBreakDuration',
    'longBreakDuration',
    'longBreakInterval',
    'soundEnabled',
    'autoStartBreaks',
    'tip',
    'completedPomodoros',
    'totalFocusTime',
    'currentStreak'
  ];

  for (const id of ids) {
    elements.set(id, new FakeElement(id));
  }

  Object.assign(elements.get('focusDuration'), { value: '25', min: '1', max: '60' });
  Object.assign(elements.get('shortBreakDuration'), { value: '5', min: '1', max: '30' });
  Object.assign(elements.get('longBreakDuration'), { value: '15', min: '1', max: '60' });
  Object.assign(elements.get('longBreakInterval'), { value: '4', min: '2', max: '10' });
  elements.get('soundEnabled').checked = true;

  const modeButtons = ['focus', 'shortBreak', 'longBreak'].map((mode) => {
    const element = new FakeElement();
    element.dataset.mode = mode;
    return element;
  });

  return {
    elements,
    getElementById(id) {
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '.timer-container' || selector === '.settings-panel') {
        return new FakeElement(selector);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.mode-btn') return modeButtons;
      if (selector === '.setting-adjust') return [];
      return [];
    },
    addEventListener() {}
  };
}

function createLocalStorage(initialState) {
  let savedValue = initialState ? JSON.stringify(initialState) : null;

  return {
    getItem() {
      return savedValue;
    },
    setItem(key, value) {
      savedValue = value;
    },
    read() {
      return savedValue ? JSON.parse(savedValue) : null;
    }
  };
}

function loadTimer(options = {}) {
  let wallNow = options.now || 0;
  let perfNow = options.performanceNow || 0;
  let intervalCallback = null;
  const notifications = [];
  const document = createDocument();
  const localStorage = createLocalStorage(options.savedState);

  const context = {
    console,
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {
      intervalCallback = null;
    },
    setTimeout(callback) {
      callback();
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    Date: class extends Date {
      constructor(...args) {
        if (args.length) {
          super(...args);
        } else {
          super(wallNow);
        }
      }

      static now() {
        return wallNow;
      }
    },
    performance: {
      now() {
        return perfNow;
      }
    },
    localStorage,
    document,
    window: {
      addEventListener() {},
      electronAPI: {
        updateTooltip() {},
        showNotification(title, body) {
          notifications.push({ title, body });
        },
        onTrayToggle() {},
        onTrayReset() {},
        removeTrayListeners() {}
      },
      AudioContext: class {
        constructor() {
          this.currentTime = 0;
          this.destination = {};
        }

        createOscillator() {
          return {
            frequency: {},
            connect() {},
            start() {},
            stop() {}
          };
        }

        createGain() {
          return {
            gain: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {}
            },
            connect() {}
          };
        }
      }
    },
    Notification: undefined,
    __notifications: notifications
  };

  context.globalThis = context;

  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  vm.runInNewContext(
    `${source}
globalThis.__timerTest = {
  state,
  startTimer,
  pauseTimer,
  tick,
  skipToNext,
  updateSetting,
  setDurationForMode,
  showNotification,
  loadState,
  saveState,
  init,
  elements,
  notifications: globalThis.__notifications
};`,
    context
  );

  return {
    api: context.__timerTest,
    document,
    localStorage,
    advance(ms) {
      wallNow += ms;
      perfNow += ms;
    },
    advanceWall(ms) {
      wallNow += ms;
    },
    advancePerf(ms) {
      perfNow += ms;
    },
    runInterval() {
      if (intervalCallback) intervalCallback();
    }
  };
}

const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.message);
    failures.push({ name, error });
  }
}

test('timer accounts for real elapsed time when ticks are delayed in the background', () => {
  const timer = loadTimer();

  timer.api.startTimer();
  timer.advance(6200);
  timer.api.tick();

  assert.strictEqual(timer.api.state.timeLeft, 1494);
});

test('timer ignores wall-clock rollback while running', () => {
  const timer = loadTimer();

  timer.api.startTimer();
  timer.advance(30000);
  timer.api.tick();
  timer.advanceWall(-60000);
  timer.api.tick();

  assert.strictEqual(timer.api.state.timeLeft, 1470);
});

test('timer does not finish early when only wall-clock jumps forward', () => {
  const timer = loadTimer();

  timer.api.startTimer();
  timer.advanceWall(30 * 60 * 1000);
  timer.api.tick();

  assert.strictEqual(timer.api.state.mode, 'focus');
  assert.strictEqual(timer.api.state.isRunning, true);
  assert.strictEqual(timer.api.state.completedPomodoros, 0);
  assert.strictEqual(timer.api.state.timeLeft, 1500);
});

test('skipping focus moves to break without counting a completed pomodoro', () => {
  const timer = loadTimer();

  timer.api.skipToNext();

  assert.strictEqual(timer.api.state.mode, 'shortBreak');
  assert.strictEqual(timer.api.state.completedPomodoros, 0);
  assert.strictEqual(timer.api.state.totalFocusMinutes, 0);
  assert.strictEqual(timer.api.notifications.length, 0);
});

test('changing focus duration while running preserves current countdown and completed minutes', () => {
  const timer = loadTimer();

  timer.api.startTimer();
  timer.advance(1000);
  timer.api.tick();
  timer.api.updateSetting('focusDuration', 60);
  timer.advance(24 * 60 * 1000 + 59 * 1000);
  timer.api.tick();

  assert.strictEqual(timer.api.state.mode, 'shortBreak');
  assert.strictEqual(timer.api.state.completedPomodoros, 1);
  assert.strictEqual(timer.api.state.totalFocusMinutes, 25);
});

test('invalid numeric settings are clamped to the input range', () => {
  const timer = loadTimer();
  const focusInput = timer.document.elements.get('focusDuration');

  focusInput.value = '';
  timer.api.updateSetting('focusDuration', Number.NaN);
  timer.api.setDurationForMode('focus');

  assert.strictEqual(timer.api.state.settings.focusDuration, 1);
  assert.strictEqual(timer.api.state.totalTime, 60);
  assert.strictEqual(timer.api.state.timeLeft, 60);
  assert.strictEqual(focusInput.value, '1');
});

test('running timer state is restored using elapsed monotonic time after reload', () => {
  const savedState = {
    mode: 'focus',
    isRunning: true,
    timeLeft: 1500,
    totalTime: 1500,
    runningStartedAt: 1000,
    runningStartedWallTime: 5000,
    completedPomodoros: 0,
    totalFocusMinutes: 0,
    currentStreak: 0,
    lastCompletionDate: null,
    settings: {
      focusDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      longBreakInterval: 4,
      soundEnabled: true,
      autoStartBreaks: false
    }
  };
  const timer = loadTimer({
    savedState,
    performanceNow: 7000,
    now: 11000
  });

  timer.api.loadState();

  assert.strictEqual(timer.api.state.isRunning, true);
  assert.strictEqual(timer.api.state.timeLeft, 1494);
});

test('focus completion notification describes the completed focus session', () => {
  const timer = loadTimer();

  timer.api.startTimer();
  timer.advance(25 * 60 * 1000);
  timer.api.tick();

  assert.strictEqual(timer.api.notifications[0].title, '🍅 番茄时间到！');
  assert.strictEqual(timer.api.notifications[0].body, '已完成 25 分钟专注，继续加油！');
});

if (failures.length > 0) {
  console.error(`${failures.length} timer regression test(s) failed`);
  process.exit(1);
}
