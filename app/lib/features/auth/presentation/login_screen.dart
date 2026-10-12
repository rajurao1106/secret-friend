import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/session/session_controller.dart';

const _authGreen = Color(0xFF315C49);
const _authInk = Color(0xFF20352D);

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _mobileController = TextEditingController();
  final _codeController = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  String _normalizedMobile() =>
      _mobileController.text.trim().replaceAll(RegExp(r'[\s-]'), '');

  @override
  void dispose() {
    _mobileController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final mobile = _mobileController.text.trim();
    if (mobile.isEmpty) {
      setState(() => _error = 'Enter your Indian mobile number.');
      return;
    }
    final normalizedMobile = _normalizedMobile();
    if (!RegExp(r'^(?:(?:\+91|91))?[6-9]\d{9}$').hasMatch(normalizedMobile)) {
      setState(() => _error = 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    await _run(() async {
      await ref.read(sessionControllerProvider).sendOtp(normalizedMobile);
      if (mounted) setState(() => _codeSent = true);
    });
  }

  Future<void> _verifyCode() async {
    final mobile = _normalizedMobile();
    final code = _codeController.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Enter the six-digit OTP.');
      return;
    }
    await _run(
      () => ref.read(sessionControllerProvider).verifyOtp(mobile, code),
    );
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(() => _error = ref.read(sessionControllerProvider).error);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F2),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(26, 35, 26, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: _authGreen,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Icon(
                      Icons.forum_rounded,
                      color: Colors.white,
                      size: 27,
                    ),
                  ),
                  const SizedBox(height: 34),
                  const Text(
                    'A little mystery.\nA genuine connection.',
                    style: TextStyle(
                      color: _authInk,
                      fontSize: 32,
                      height: 1.12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Meet kind people as your anonymous self. Your personal details stay private until you both choose to reveal.',
                    style: TextStyle(
                      color: Color(0xFF7D8981),
                      fontSize: 14,
                      height: 1.55,
                    ),
                  ),
                  const SizedBox(height: 34),
                  Text(
                    _codeSent ? 'Enter your OTP' : 'Your mobile number',
                    style: const TextStyle(
                      color: _authInk,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 11),
                  TextField(
                    controller: _mobileController,
                    enabled: !_codeSent && !_busy,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    decoration: _inputDecoration(
                      hint: '+91 98765 43210',
                      prefix: const Icon(Icons.phone_android_rounded),
                    ),
                  ),
                  if (_codeSent) ...[
                    const SizedBox(height: 14),
                    TextField(
                      controller: _codeController,
                      enabled: !_busy,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textInputAction: TextInputAction.done,
                      decoration: _inputDecoration(
                        hint: '6-digit code',
                        prefix: const Icon(Icons.password_rounded),
                      ).copyWith(counterText: ''),
                    ),
                    const SizedBox(height: 7),
                    const Text(
                      'Development mode: check the server terminal for the OTP.',
                      style: TextStyle(color: Color(0xFF7D8981), fontSize: 12),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    _ErrorMessage(message: _error!),
                  ],
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton(
                      onPressed: _busy
                          ? null
                          : (_codeSent ? _verifyCode : _sendCode),
                      style: FilledButton.styleFrom(
                        backgroundColor: _authGreen,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : Text(
                              _codeSent
                                  ? 'Verify & continue'
                                  : 'Send me a code',
                            ),
                    ),
                  ),
                  if (_codeSent) ...[
                    const SizedBox(height: 10),
                    Center(
                      child: TextButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() {
                                _codeSent = false;
                                _error = null;
                              }),
                        child: const Text('Change mobile number'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 23),
                  const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.lock_outline_rounded,
                        color: _authGreen,
                        size: 17,
                      ),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'We use your number to sign in. Other people never see it unless you choose to share it after a mutual reveal.',
                          style: TextStyle(
                            color: Color(0xFF7D8981),
                            fontSize: 11,
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

InputDecoration _inputDecoration({required String hint, Widget? prefix}) {
  return InputDecoration(
    hintText: hint,
    prefixIcon: prefix,
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE8E9E1)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE8E9E1)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: _authGreen, width: 1.5),
    ),
  );
}

class _ErrorMessage extends StatelessWidget {
  const _ErrorMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFECE9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: Color(0xFF9C352B),
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              message,
              style: const TextStyle(
                color: Color(0xFF9C352B),
                fontSize: 13,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
