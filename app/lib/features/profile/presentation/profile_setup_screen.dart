import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/session/session_controller.dart';

const _green = Color(0xFF315C49);
const _dark = Color(0xFF20352D);

class ProfileSetupScreen extends ConsumerStatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  ConsumerState<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends ConsumerState<ProfileSetupScreen> {
  final _nicknameController = TextEditingController();
  final _bioController = TextEditingController();
  DateTime _dob = DateTime(1998, 1, 1);
  String _gender = 'other';
  List<Map<String, dynamic>> _hobbies = [];
  final Set<String> _selectedHobbies = {};
  bool _loadingHobbies = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadHobbies();
  }

  @override
  void dispose() {
    _nicknameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _loadHobbies() async {
    try {
      final response = await ref
          .read(secretFriendApiProvider)
          .request<List<dynamic>>('/hobbies', authenticated: false);
      if (!mounted) return;
      setState(() {
        _hobbies = response.data
                ?.whereType<Map<String, dynamic>>()
                .toList(growable: false) ??
            [];
        _loadingHobbies = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _loadingHobbies = false;
          _error = ref.read(secretFriendApiProvider).errorMessage(error);
        });
      }
    }
  }

  Future<void> _chooseDate() async {
    final today = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      initialDate: _dob,
      firstDate: DateTime(1900),
      lastDate: DateTime(today.year - 18, today.month, today.day),
      helpText: 'Choose your date of birth',
    );
    if (selected != null) setState(() => _dob = selected);
  }

  Future<void> _save() async {
    final nickname = _nicknameController.text.trim();
    if (nickname.isEmpty) {
      setState(() => _error = 'Choose an anonymous nickname to continue.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(sessionControllerProvider).saveProfile({
        'nickname': nickname,
        'gender': _gender,
        'dob':
            '${_dob.year.toString().padLeft(4, '0')}-${_dob.month.toString().padLeft(2, '0')}-${_dob.day.toString().padLeft(2, '0')}',
        'bio': _bioController.text.trim(),
        'hobbies': _selectedHobbies.toList(),
        'sports': <String>[],
      });
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = ref.read(secretFriendApiProvider).errorMessage(error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F2),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFAF8F2),
        title: const Text('Make it yours'),
        leading: const SizedBox.shrink(),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 8, 22, 30),
              children: [
                const Text(
                  'Your anonymous self',
                  style: TextStyle(
                    color: _dark,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -.7,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Choose what people see before you both decide to reveal.',
                  style: TextStyle(color: Color(0xFF7D8981), height: 1.45),
                ),
                const SizedBox(height: 25),
                TextField(
                  controller: _nicknameController,
                  maxLength: 40,
                  decoration: _decoration(
                    label: 'Anonymous nickname',
                    hint: 'e.g. MoonlitMango',
                    icon: Icons.auto_awesome_outlined,
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _gender,
                  decoration: _decoration(
                    label: 'Gender',
                    icon: Icons.person_outline_rounded,
                  ),
                  items: const [
                    DropdownMenuItem(value: 'female', child: Text('Female')),
                    DropdownMenuItem(value: 'male', child: Text('Male')),
                    DropdownMenuItem(value: 'other', child: Text('Other')),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _gender = value);
                  },
                ),
                const SizedBox(height: 18),
                const Text(
                  'Date of birth',
                  style: TextStyle(
                    color: _dark,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _chooseDate,
                  icon: const Icon(Icons.calendar_month_outlined),
                  label: Text(
                    '${_dob.day.toString().padLeft(2, '0')}/${_dob.month.toString().padLeft(2, '0')}/${_dob.year}',
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _dark,
                    backgroundColor: Colors.white,
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 16,
                    ),
                    side: const BorderSide(color: Color(0xFFE8E9E1)),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 7),
                  child: Text(
                    'You must be 18 or older. Your birth date is never shown on discovery.',
                    style: TextStyle(color: Color(0xFF7D8981), fontSize: 11),
                  ),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _bioController,
                  maxLength: 500,
                  maxLines: 3,
                  decoration: _decoration(
                    label: 'A little about you',
                    hint: 'Your bio is private until you both reveal.',
                    icon: Icons.edit_note_rounded,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Things you enjoy',
                  style: TextStyle(
                    color: _dark,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 9),
                if (_loadingHobbies)
                  const Center(child: CircularProgressIndicator())
                else if (_hobbies.isEmpty)
                  const Text(
                    'Interests will be available once they are added by the server.',
                    style: TextStyle(color: Color(0xFF7D8981), fontSize: 12),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 1,
                    children: [
                      for (final hobby in _hobbies)
                        if (hobby['id'] is String && hobby['name'] is String)
                          FilterChip(
                            label: Text(hobby['name']! as String),
                            selected: _selectedHobbies.contains(
                              hobby['id']! as String,
                            ),
                            onSelected: (selected) {
                              setState(() {
                                final id = hobby['id']! as String;
                                if (selected) {
                                  _selectedHobbies.add(id);
                                } else {
                                  _selectedHobbies.remove(id);
                                }
                              });
                            },
                          ),
                    ],
                  ),
                const SizedBox(height: 20),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Color(0xFFB74638)),
                    ),
                  ),
                SizedBox(
                  height: 52,
                  child: FilledButton(
                    onPressed: _saving ? null : _save,
                    style: FilledButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: _saving
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2,
                            ),
                          )
                        : const Text('Continue to discover'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

InputDecoration _decoration({
  required String label,
  String? hint,
  required IconData icon,
}) {
  return InputDecoration(
    labelText: label,
    hintText: hint,
    prefixIcon: Icon(icon, color: _green),
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(15),
      borderSide: const BorderSide(color: Color(0xFFE8E9E1)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(15),
      borderSide: const BorderSide(color: Color(0xFFE8E9E1)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(15),
      borderSide: const BorderSide(color: _green, width: 1.5),
    ),
  );
}
