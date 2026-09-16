// 마우스로 숫자를 눌러 비밀번호를 입력하는 온스크린 키패드.
// 키보드를 쓸 수 없는 환경(예: 마우스만 있는 PC)에서 접속할 수 있게 한다.
// 사용법: <div class="keypad" data-keypad-target="#passwordInput"></div>
//        <script src="keypad.js"></script>
(function () {
  function build(container) {
    const input = document.querySelector(container.getAttribute('data-keypad-target'));
    if (!input) return;

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'];
    keys.forEach((k) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'keypad-btn';
      if (k === 'C') btn.classList.add('key-clear');
      if (k === '←') btn.classList.add('key-back');
      btn.textContent = k;
      btn.addEventListener('click', () => {
        if (k === 'C') input.value = '';
        else if (k === '←') input.value = input.value.slice(0, -1);
        else input.value += k;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      container.appendChild(btn);
    });
  }

  document.querySelectorAll('.keypad').forEach(build);
})();
