import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/session/session_controller.dart';
import 'package:secret_friend/features/auth/presentation/login_screen.dart';
import 'package:secret_friend/features/home/presentation/home_screen.dart';
import 'package:secret_friend/features/profile/presentation/profile_setup_screen.dart';

class SecretFriendApp extends ConsumerWidget {
  const SecretFriendApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);

    return AnimatedBuilder(
      animation: session,
      builder: (context, _) => MaterialApp(
        title: 'Secret Friend',
        theme: ThemeData(
          colorScheme: const ColorScheme(
            brightness: Brightness.light,
            primary: Color(0xFF315C49),
            onPrimary: Colors.white,
            secondary: Color(0xFFE6B779),
            onSecondary: Color(0xFF20352D),
            error: Color(0xFFB74638),
            onError: Colors.white,
            surface: Color(0xFFFAF8F2),
            onSurface: Color(0xFF20352D),
          ),
          scaffoldBackgroundColor: const Color(0xFFFAF8F2),
          snackBarTheme: const SnackBarThemeData(
            behavior: SnackBarBehavior.floating,
            backgroundColor: Color(0xFF20352D),
          ),
          chipTheme: ChipThemeData(
            backgroundColor: Colors.white,
            selectedColor: const Color(0xFF315C49),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
          ),
          splashFactory: InkRipple.splashFactory,
          useMaterial3: true,
        ),
        home: switch (session.stage) {
          AppStage.loading => const _LoadingScreen(),
          AppStage.signedOut => const LoginScreen(),
          AppStage.profileRequired => const ProfileSetupScreen(),
          AppStage.ready => const HomeScreen(),
        },
      ),
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
