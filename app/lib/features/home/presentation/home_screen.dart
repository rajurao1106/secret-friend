import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';
import 'package:secret_friend/core/session/session_controller.dart';
import 'package:secret_friend/features/chat/presentation/chat_screen.dart';

const _ink = Color(0xFF20352D);
const _forest = Color(0xFF315C49);
const _paper = Color(0xFFFAF8F2);
const _muted = Color(0xFF7D8981);
const _line = Color(0xFFE8E9E1);

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _tab = 0;
  int _filter = 0;
  List<_Friend> _people = [];
  List<_Friend> _chats = [];
  List<Map<String, dynamic>> _requests = [];
  List<Map<String, dynamic>> _hobbies = [];
  String? _requestsError;
  bool _discoverLoading = true;
  bool _chatsLoading = true;
  bool _requestsLoading = true;
  String? _discoverError;
  String? _chatsError;

  List<String> get _filters => [
    'For you',
    ..._hobbies.map((hobby) => hobby['name'] as String),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadHobbies();
      _loadDiscover();
      _loadChats();
      _loadRequests();
    });
  }

  SecretFriendApi get _api => ref.read(secretFriendApiProvider);

  Future<void> _loadHobbies() async {
    try {
      final response = await _api.request<List<dynamic>>(
        '/hobbies',
        authenticated: false,
      );
      if (!mounted) return;
      setState(() {
        _hobbies = response.data
                ?.whereType<Map<String, dynamic>>()
                .toList(growable: false) ??
            [];
      });
    } catch (error) {
      if (mounted) {
        _showMessage(
          'Could not load interest filters: ${_api.errorMessage(error)}',
        );
      }
    }
  }

  Future<void> _loadDiscover() async {
    if (!mounted) return;
    setState(() {
      _discoverLoading = true;
      _discoverError = null;
    });
    try {
      final selectedHobby =
          _filter > 0 && _filter <= _hobbies.length
              ? _hobbies[_filter - 1]['id'] as String?
              : null;
      final response = await _api.request<Map<String, dynamic>>(
        '/discover',
        queryParameters: selectedHobby == null
            ? null
            : {'hobbies': selectedHobby},
      );
      final items = response.data?['items'];
      if (!mounted) return;
      setState(() {
        _people = items is List
            ? items
                  .whereType<Map<String, dynamic>>()
                  .map(_Friend.fromJson)
                  .toList(growable: false)
            : [];
        _discoverLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _discoverLoading = false;
        _discoverError = _api.errorMessage(error);
      });
    }
  }

  Future<void> _loadChats() async {
    if (!mounted) return;
    setState(() {
      _chatsLoading = true;
      _chatsError = null;
    });
    try {
      final response = await _api.request<Map<String, dynamic>>('/users');
      final items = response.data?['items'];
      if (!mounted) return;
      setState(() {
        _chats = items is List
            ? items
                  .whereType<Map<String, dynamic>>()
                  .map(_Friend.fromJson)
                  .toList(growable: false)
            : [];
        _chatsLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _chatsLoading = false;
        _chatsError = _api.errorMessage(error);
      });
    }
  }

  Future<void> _loadRequests() async {
    try {
      final response = await _api.request<List<dynamic>>(
        '/friend-requests',
        queryParameters: {'type': 'received'},
      );
      if (!mounted) return;
      setState(() {
        _requests = response.data
                ?.whereType<Map<String, dynamic>>()
                .where((item) {
                  final request = item['request'];
                  return request is Map<String, dynamic> &&
                      request['status'] == 'pending';
                })
                .toList(growable: false) ??
            [];
        _requestsLoading = false;
        _requestsError = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _requestsLoading = false;
          _requestsError = _api.errorMessage(error);
        });
      }
    }
  }

  Future<void> _openChat(_Friend friend) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ChatScreen(userId: friend.id, nickname: friend.nickname),
      ),
    );
    _loadChats();
    _loadRequests();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: _ink,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final contentWidth = width > 560 ? 560.0 : width;

    return Scaffold(
      backgroundColor: _paper,
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: contentWidth,
            child: Column(
              children: [
                _TopBar(
                  title: switch (_tab) {
                    1 => 'Find a conversation',
                    2 => 'Friend requests',
                    3 => 'Your little corner',
                    _ => 'Secret Friend',
                  },
                  onSafetyTap: () => _showMessage(
                    'Your identity stays private until you both reveal.',
                  ),
                ),
                Expanded(
                  child: IndexedStack(
                    index: _tab,
                    children: [
                      _discoverTab(),
                      _chatsTab(),
                      _requestsTab(),
                      _profileTab(),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: _BottomBar(
        currentIndex: _tab,
        onChanged: (index) => setState(() => _tab = index),
      ),
    );
  }

  Widget _discoverTab() {
    return CustomScrollView(
      key: const PageStorageKey('discover'),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 28),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              const _PrivacyNote(),
              const SizedBox(height: 26),
              Text(
                'Find your kind\nof people.',
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                  color: _ink,
                  fontSize: 35,
                  height: 1.08,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -1.2,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Real conversations start with shared little things.',
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: _muted, fontSize: 14),
              ),
              const SizedBox(height: 22),
              _FilterRow(
                selected: _filter,
                labels: _filters,
                onSelected: (index) {
                  setState(() => _filter = index);
                  _loadDiscover();
                },
              ),
              const SizedBox(height: 20),
              if (_discoverLoading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 36),
                child: Center(child: CircularProgressIndicator()),
              )
              else if (_discoverError != null)
              _LoadError(
                message: _discoverError!,
                onRetry: _loadDiscover,
              )
              else if (_people.isEmpty)
              const _EmptyPeople()
              else ...[
              _featuredCard(_people.first),
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'More kindred spirits',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: _ink,
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton(onPressed: _loadDiscover, child: const Text('Refresh')),
                ],
              ),
              const SizedBox(height: 8),
              for (final person in _people.skip(1)) ...[
                _FriendListTile(
                  friend: person,
                  onTap: () => _openChat(person),
                ),
                const SizedBox(height: 12),
              ],
              const SizedBox(height: 12),
              const _GentleReminder(),
              ],
            ]),
          ),
        ),
      ],
    );
  }

  Widget _featuredCard(_Friend friend) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: _line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C20352D),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            children: [
              Container(
                height: 168,
                width: double.infinity,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFFF8DFB6), Color(0xFFE9C1A3)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Positioned(
                      right: -18,
                      top: -44,
                      child: _GlowOrb(
                        size: 170,
                        color: Colors.white.withValues(alpha: .24),
                      ),
                    ),
                    Positioned(
                      left: -32,
                      bottom: -76,
                      child: _GlowOrb(
                        size: 174,
                        color: const Color(0x44FFFFFF),
                      ),
                    ),
                    _FriendAvatar(friend: friend, size: 106),
                    Positioned(
                      top: 16,
                      left: 16,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .78),
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.auto_awesome, size: 14, color: _forest),
                            SizedBox(width: 5),
                            Text(
                              'A little like you',
                              style: TextStyle(
                                color: _ink,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      right: 15,
                      top: 14,
                      child: const SizedBox.shrink(),
                    ),
                  ],
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(19, 17, 19, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        friend.nickname,
                        style: const TextStyle(
                          color: _ink,
                          fontWeight: FontWeight.w800,
                          fontSize: 20,
                          letterSpacing: -.3,
                        ),
                      ),
                    ),
                    const Icon(Icons.circle, size: 8, color: Color(0xFF66A77A)),
                    const SizedBox(width: 6),
                    const Text(
                      'Around now',
                      style: TextStyle(color: _muted, fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  friend.subtitle,
                  style: const TextStyle(color: _muted, fontSize: 13),
                ),
                const SizedBox(height: 14),
                Text(
                  '“${friend.note}”',
                  style: const TextStyle(
                    color: _ink,
                    fontSize: 13,
                    height: 1.45,
                    fontStyle: FontStyle.italic,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: friend.interests
                      .map((interest) => _InterestChip(label: interest))
                      .toList(),
                ),
                const SizedBox(height: 17),
                SizedBox(
                  width: double.infinity,
                  height: 49,
                  child: FilledButton.icon(
                    onPressed: () => _openChat(friend),
                    icon: const Icon(
                      Icons.chat_bubble_outline_rounded,
                      size: 18,
                    ),
                    label: const Text('Say a little hello'),
                    style: FilledButton.styleFrom(
                      backgroundColor: _forest,
                      foregroundColor: Colors.white,
                      textStyle: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(15),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _chatsTab() {
    if (_chatsLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_chatsError != null) {
      return _LoadError(message: _chatsError!, onRetry: _loadChats);
    }
    if (_chats.isEmpty) {
      return _SimpleTabContent(
        icon: Icons.forum_outlined,
        title: 'Good talks begin here',
        subtitle:
            'There are no other profiles yet. Invite a friend to join Secret Friend.',
        action: 'Refresh people',
        onAction: _loadChats,
      );
    }
    return RefreshIndicator(
      onRefresh: _loadChats,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 0, 4, 12),
            child: Text(
              'People on Secret Friend',
              style: TextStyle(
                color: _ink,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          for (final person in _chats) ...[
            _FriendListTile(friend: person, onTap: () => _openChat(person)),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }

  Widget _requestsTab() {
    if (_requestsLoading) return const Center(child: CircularProgressIndicator());
    if (_requestsError != null) {
      return _LoadError(message: _requestsError!, onRetry: _loadRequests);
    }
    if (_requests.isEmpty) {
      return _SimpleTabContent(
        icon: Icons.waving_hand_outlined,
        title: 'No new reveal requests',
        subtitle:
            'Requests appear after you and a friend have chatted and someone asks to reveal.',
        action: 'Discover friends',
        onAction: () => setState(() => _tab = 0),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadRequests,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
        children: [
          const Text(
            'Reveal requests',
            style: TextStyle(
              color: _ink,
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Your details unlock only when you accept each other.',
            style: TextStyle(color: _muted, fontSize: 12),
          ),
          const SizedBox(height: 15),
          for (final row in _requests)
            _RevealRequestCard(
              row: row,
              onAccept: () => _respondToRequest(row, accept: true),
              onReject: () => _respondToRequest(row, accept: false),
            ),
        ],
      ),
    );
  }

  Widget _profileTab() {
    final session = ref.watch(sessionControllerProvider);
    final me = session.me ?? {};
    final profile = me['profile'] is Map<String, dynamic>
        ? me['profile']! as Map<String, dynamic>
        : <String, dynamic>{};
    final userName = profile['nickname'] as String? ?? 'Your anonymous self';
    final shareMobile = profile['shareMobile'] as bool? ?? false;
    final avatarIndex = me['avatarIndex'] as int? ?? 0;
    final hobbyNames = (me['hobbies'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map((item) => item['name'])
        .whereType<String>()
        .join(', ');
    return ListView(
      padding: const EdgeInsets.fromLTRB(22, 18, 22, 32),
      children: [
        const _PrivacyNote(),
        const SizedBox(height: 28),
        Center(child: _SelfAvatar(index: avatarIndex)),
        const SizedBox(height: 16),
        const Text(
          'Your anonymous self',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: _ink,
            fontSize: 23,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          userName,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _forest,
            fontSize: 17,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Your real photo and personal details stay hidden until you both choose to reveal.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _muted, height: 1.5),
        ),
        const SizedBox(height: 25),
        _SettingsTile(
          icon: Icons.interests_outlined,
          title: 'Your interests',
          subtitle: hobbyNames.isEmpty ? 'No interests selected' : hobbyNames,
          onTap: () => _showMessage('You can update interests from profile setup later.'),
        ),
        SwitchListTile.adaptive(
          contentPadding: const EdgeInsets.symmetric(horizontal: 4),
          secondary: const Icon(Icons.phone_iphone_rounded, color: _forest),
          title: const Text(
            'Share mobile after reveal',
            style: TextStyle(color: _ink, fontWeight: FontWeight.w700),
          ),
          subtitle: const Text(
            'Only visible after you both reveal',
            style: TextStyle(color: _muted, fontSize: 12),
          ),
          value: shareMobile,
          onChanged: (value) async {
            try {
              await _api.request<void>(
                '/me/settings',
                method: 'PATCH',
                data: {'shareMobile': value},
              );
              await session.loadMe();
            } catch (error) {
              _showMessage(_api.errorMessage(error));
            }
          },
        ),
        _SettingsTile(
          icon: Icons.shield_outlined,
          title: 'Privacy & safety',
          subtitle: 'You are in control of what you share',
          onTap: () => _showSafetyOptions(),
        ),
        _SettingsTile(
          icon: Icons.tune_rounded,
          title: 'Preferences',
          subtitle: 'Manage your account',
          onTap: _showAccountOptions,
        ),
      ],
    );
  }

  Future<void> _respondToRequest(
    Map<String, dynamic> row, {
    required bool accept,
  }) async {
    final request = row['request'];
    if (request is! Map<String, dynamic> || request['id'] is! String) return;
    try {
      final requestId = request['id']! as String;
      await _api.request<void>(
        '/friend-requests/$requestId/${accept ? 'accept' : 'reject'}',
        method: 'POST',
      );
      await _loadRequests();
      _showMessage(accept ? 'You revealed your profiles to each other.' : 'Request declined.');
      final otherUser = row['otherUser'];
      if (accept && otherUser is Map<String, dynamic>) {
        await _openChat(_Friend.fromJson(otherUser));
      }
    } catch (error) {
      _showMessage(_api.errorMessage(error));
    }
  }

  Future<void> _showSafetyOptions() async {
    final blocked = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            const ListTile(
              title: Text('Privacy & safety'),
              subtitle: Text('Your details are protected until a mutual reveal.'),
            ),
            ListTile(
              leading: const Icon(Icons.block_outlined),
              title: const Text('Manage blocked accounts'),
              onTap: () => Navigator.pop(context, 'blocks'),
            ),
          ],
        ),
      ),
    );
    if (blocked != 'blocks' || !mounted) return;
    try {
      final response = await _api.request<List<dynamic>>('/blocks');
      final blockList = response.data ?? [];
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Blocked accounts'),
          content: SizedBox(
            width: 350,
            child: blockList.isEmpty
                ? const Text('You have not blocked anyone.')
                : ListView(
                    shrinkWrap: true,
                    children: blockList.whereType<Map<String, dynamic>>().map((item) {
                      final id = item['id'] as String? ?? '';
                      return ListTile(
                        title: Text(item['nickname'] as String? ?? 'Friend'),
                        trailing: TextButton(
                          onPressed: () async {
                            await _api.request<void>(
                              '/blocks/$id',
                              method: 'DELETE',
                            );
                            if (context.mounted) Navigator.pop(context);
                            _loadDiscover();
                          },
                          child: const Text('Unblock'),
                        ),
                      );
                    }).toList(),
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (error) {
      _showMessage(_api.errorMessage(error));
    }
  }

  Future<void> _showAccountOptions() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.logout_rounded),
              title: const Text('Sign out'),
              onTap: () => Navigator.pop(context, 'logout'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded, color: Colors.red),
              title: const Text('Delete my account'),
              onTap: () => Navigator.pop(context, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'logout') {
      await ref.read(sessionControllerProvider).logout();
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'Your profile and personal data will be deleted. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _api.request<void>('/me', method: 'DELETE');
      await _api.clearTokens();
      await ref.read(sessionControllerProvider).restore();
    } catch (error) {
      _showMessage(_api.errorMessage(error));
    }
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.title, required this.onSafetyTap});

  final String title;
  final VoidCallback onSafetyTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 8, 18, 8),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: _forest,
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Icon(
              Icons.forum_rounded,
              color: Colors.white,
              size: 21,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: _ink,
                fontWeight: FontWeight.w800,
                fontSize: 17,
                letterSpacing: -.3,
              ),
            ),
          ),
          IconButton(
            tooltip: 'Privacy and safety',
            onPressed: onSafetyTap,
            icon: const Icon(Icons.shield_outlined, color: _forest),
          ),
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('You are all caught up!'),
                behavior: SnackBarBehavior.floating,
              ),
            ),
            icon: const Icon(Icons.notifications_none_rounded, color: _ink),
          ),
        ],
      ),
    );
  }
}

class _PrivacyNote extends StatelessWidget {
  const _PrivacyNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF0E9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.lock_outline_rounded, color: _forest, size: 15),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Anonymous by default. Always your choice.',
              style: TextStyle(
                color: _forest,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Icon(Icons.arrow_forward_ios_rounded, color: _forest, size: 12),
        ],
      ),
    );
  }
}

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.selected,
    required this.labels,
    required this.onSelected,
  });

  final int selected;
  final List<String> labels;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (var index = 0; index < labels.length; index++) ...[
            ChoiceChip(
              label: Text(labels[index]),
              selected: selected == index,
              onSelected: (_) => onSelected(index),
              showCheckmark: false,
              labelStyle: TextStyle(
                color: selected == index ? Colors.white : _ink,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
              backgroundColor: Colors.white,
              selectedColor: _forest,
              side: BorderSide(color: selected == index ? _forest : _line),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _FriendAvatar extends StatelessWidget {
  const _FriendAvatar({required this.friend, required this.size});

  final _Friend friend;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [friend.color, friend.color.withValues(alpha: .72)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: Colors.white.withValues(alpha: .8), width: 4),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2220352D),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Icon(
        friend.icon,
        color: _ink.withValues(alpha: .78),
        size: size * .43,
      ),
    );
  }
}

class _GlowOrb extends StatelessWidget {
  const _GlowOrb({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(shape: BoxShape.circle, color: color),
  );
}

class _InterestChip extends StatelessWidget {
  const _InterestChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0xFFF3F4EF),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      label,
      style: const TextStyle(
        color: _ink,
        fontSize: 11,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

class _FriendListTile extends StatelessWidget {
  const _FriendListTile({
    required this.friend,
    required this.onTap,
  });

  final _Friend friend;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: _line),
          ),
          child: Row(
            children: [
              _FriendAvatar(friend: friend, size: 58),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      friend.nickname,
                      style: const TextStyle(
                        color: _ink,
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      friend.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: _muted, fontSize: 11),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      friend.interests.take(2).join('  ·  '),
                      style: const TextStyle(
                        color: _forest,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: _muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _GentleReminder extends StatelessWidget {
  const _GentleReminder();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF1EDE3),
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.spa_outlined, color: _forest, size: 20),
          SizedBox(width: 11),
          Expanded(
            child: Text(
              'Take it at your pace. Your real details stay yours until you both agree to reveal.',
              style: TextStyle(color: _ink, fontSize: 12, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}

class _SimpleTabContent extends StatelessWidget {
  const _SimpleTabContent({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.action,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0xFFEAF0E9),
              ),
              child: Icon(icon, color: _forest, size: 40),
            ),
            const SizedBox(height: 23),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _ink,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: _muted, height: 1.5),
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: onAction,
              style: FilledButton.styleFrom(
                backgroundColor: _forest,
                foregroundColor: Colors.white,
              ),
              child: Text(action),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      leading: Container(
        width: 43,
        height: 43,
        decoration: BoxDecoration(
          color: const Color(0xFFEAF0E9),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Icon(icon, color: _forest),
      ),
      title: Text(
        title,
        style: const TextStyle(color: _ink, fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(color: _muted, fontSize: 12),
      ),
      trailing: const Icon(Icons.chevron_right_rounded, color: _muted),
      onTap: onTap,
    );
  }
}

  class _RevealRequestCard extends StatelessWidget {
    const _RevealRequestCard({
      required this.row,
      required this.onAccept,
      required this.onReject,
    });

    final Map<String, dynamic> row;
    final VoidCallback onAccept;
    final VoidCallback onReject;

    @override
    Widget build(BuildContext context) {
      final user = row['otherUser'] is Map<String, dynamic>
          ? row['otherUser']! as Map<String, dynamic>
          : <String, dynamic>{};
      final friend = _Friend.fromJson(user);
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: _line),
        ),
        child: Column(
          children: [
            Row(
              children: [
                _FriendAvatar(friend: friend, size: 54),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        friend.nickname,
                        style: const TextStyle(
                          color: _ink,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        'Would like to reveal their profile',
                        style: TextStyle(color: _muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onReject,
                    child: const Text('Not now'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: onAccept,
                    style: FilledButton.styleFrom(
                      backgroundColor: _forest,
                      foregroundColor: Colors.white,
                    ),
                    child: const Text('Reveal together'),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }
  }

  class _LoadError extends StatelessWidget {
    const _LoadError({required this.message, required this.onRetry});

    final String message;
    final VoidCallback onRetry;

    @override
    Widget build(BuildContext context) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          children: [
            const Icon(Icons.cloud_off_outlined, color: _muted, size: 35),
            const SizedBox(height: 10),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: _muted, fontSize: 12),
            ),
            const SizedBox(height: 10),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }
  }

  class _EmptyPeople extends StatelessWidget {
    const _EmptyPeople();

    @override
    Widget build(BuildContext context) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 40),
        child: Column(
          children: [
            Icon(Icons.diversity_1_outlined, color: _forest, size: 48),
            SizedBox(height: 14),
            Text(
              'Your people are on their way',
              style: TextStyle(
                color: _ink,
                fontWeight: FontWeight.w800,
                fontSize: 17,
              ),
            ),
            SizedBox(height: 7),
            Text(
              'There are no profiles to show yet. Check back soon.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _muted, fontSize: 12),
            ),
          ],
        ),
      );
    }
  }

  class _SelfAvatar extends StatelessWidget {
    const _SelfAvatar({required this.index});

    final int index;

    static const _colors = [
      Color(0xFFF2B58B),
      Color(0xFFA9C7B5),
      Color(0xFFEACB78),
      Color(0xFFC1B2D8),
      Color(0xFF8FC4CC),
      Color(0xFFE39B9B),
      Color(0xFFA6B7DD),
      Color(0xFFC3CC8D),
    ];
    static const _icons = [
      Icons.wb_twilight_rounded,
      Icons.auto_awesome_rounded,
      Icons.local_florist_rounded,
      Icons.nightlight_round,
      Icons.park_rounded,
      Icons.water_drop_rounded,
      Icons.cloud_rounded,
      Icons.spa_rounded,
    ];

    @override
    Widget build(BuildContext context) {
      final normalized = index.abs() % _colors.length;
      return Container(
        width: 94,
        height: 94,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: _colors[normalized],
          border: Border.all(color: Colors.white, width: 4),
        ),
        child: Icon(_icons[normalized], color: _ink, size: 40),
      );
    }
  }

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.currentIndex, required this.onChanged});

  final int currentIndex;
  final ValueChanged<int> onChanged;

  static const _items = [
    (icon: Icons.explore_outlined, selected: Icons.explore, label: 'Discover'),
    (
      icon: Icons.chat_bubble_outline_rounded,
      selected: Icons.chat_bubble_rounded,
      label: 'Chats',
    ),
    (
      icon: Icons.favorite_border_rounded,
      selected: Icons.favorite_rounded,
      label: 'Requests',
    ),
    (
      icon: Icons.person_outline_rounded,
      selected: Icons.person_rounded,
      label: 'You',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _line)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(
            children: [
              for (var index = 0; index < _items.length; index++)
                Expanded(
                  child: _BottomItem(
                    item: _items[index],
                    selected: currentIndex == index,
                    onTap: () => onChanged(index),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomItem extends StatelessWidget {
  const _BottomItem({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final ({IconData icon, IconData selected, String label}) item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            selected ? item.selected : item.icon,
            color: selected ? _forest : _muted,
            size: 21,
          ),
          const SizedBox(height: 4),
          Text(
            item.label,
            style: TextStyle(
              color: selected ? _forest : _muted,
              fontSize: 10,
              fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _Friend {
  const _Friend({
    required this.id,
    required this.nickname,
    required this.subtitle,
    required this.interests,
    required this.color,
    required this.icon,
    required this.note,
  });

  factory _Friend.fromJson(Map<String, dynamic> json) {
    final rawHobbies = json['hobbies'];
    final interests = rawHobbies is List
        ? rawHobbies
              .whereType<Map<String, dynamic>>()
              .map((hobby) => hobby['name'])
              .whereType<String>()
              .toList(growable: false)
        : <String>[];
    final index = json['avatarIndex'] is int
        ? json['avatarIndex']! as int
        : 0;
    final avatar = _SelfAvatar._colors[index.abs() % _SelfAvatar._colors.length];
    return _Friend(
      id: json['id'] as String? ?? '',
      nickname: json['nickname'] as String? ?? 'Anonymous friend',
      subtitle: interests.isEmpty
          ? 'Here for a good conversation'
          : 'Also enjoys ${interests.take(2).join(' and ')}',
      interests: interests,
      color: avatar,
      icon: _SelfAvatar._icons[index.abs() % _SelfAvatar._icons.length],
      note: interests.isEmpty
          ? 'A new connection could start with a simple hello.'
          : 'Maybe you can swap stories about ${interests.first.toLowerCase()}.',
    );
  }

  final String id;
  final String nickname;
  final String subtitle;
  final List<String> interests;
  final Color color;
  final IconData icon;
  final String note;
}
